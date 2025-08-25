// tests/RoyaltyDistributor.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Share {
  contributor: string;
  percentage: number;
}

interface DistributionRecord {
  patentId: string;
  amount: number;
  tokenType: string | null;
  timestamp: number;
  distributor: string;
}

interface ContributorPayout {
  totalReceived: number;
}

interface ContractState {
  contractOwner: string;
  paused: boolean;
  totalDistributed: number;
  distributionCounter: number;
  patentShares: Map<string, { shares: Share[] }>;
  distributionHistory: Map<number, DistributionRecord>;
  contributorPayouts: Map<string, ContributorPayout>; // key: `${patentId}-${contributor}`
}

// Mock trait implementations
class MockPatentRegistry {
  private patents: Map<string, { owner: string; contributors: string[]; registered: boolean }> = new Map();

  setPatent(patentId: string, owner: string, contributors: string[]) {
    this.patents.set(patentId, { owner, contributors, registered: true });
  }

  getPatentOwner(patentId: string): ClarityResponse<string> {
    const patent = this.patents.get(patentId);
    return patent ? { ok: true, value: patent.owner } : { ok: false, value: 101 };
  }

  getPatentContributors(patentId: string): ClarityResponse<string[]> {
    const patent = this.patents.get(patentId);
    return patent ? { ok: true, value: patent.contributors } : { ok: false, value: 101 };
  }

  isPatentRegistered(patentId: string): ClarityResponse<boolean> {
    const patent = this.patents.get(patentId);
    return { ok: true, value: !!patent && patent.registered };
  }
}

class MockTokenTrait {
  private balances: Map<string, number> = new Map();

  setBalance(account: string, balance: number) {
    this.balances.set(account, balance);
  }

  transfer(amount: number, from: string, to: string): ClarityResponse<boolean> {
    const fromBal = this.balances.get(from) ?? 0;
    if (fromBal < amount) return { ok: false, value: 105 };
    this.balances.set(from, fromBal - amount);
    const toBal = this.balances.get(to) ?? 0;
    this.balances.set(to, toBal + amount);
    return { ok: true, value: true };
  }

  getBalance(account: string): ClarityResponse<number> {
    return { ok: true, value: this.balances.get(account) ?? 0 };
  }
}

// Mock contract implementation
class RoyaltyDistributorMock {
  private state: ContractState = {
    contractOwner: "deployer",
    paused: false,
    totalDistributed: 0,
    distributionCounter: 0,
    patentShares: new Map(),
    distributionHistory: new Map(),
    contributorPayouts: new Map(),
  };

  private MAX_CONTRIBUTORS = 50;
  private MAX_SHARE_PERCENTAGE = 100;
  private MIN_DEPOSIT_AMOUNT = 1;
  private ERR_NOT_AUTHORIZED = 100;
  private ERR_INVALID_PATENT = 101;
  private ERR_INVALID_SHARE = 102;
  private ERR_NO_CONTRIBUTORS = 103;
  private ERR_DISTRIBUTION_FAILED = 104;
  private ERR_INVALID_AMOUNT = 105;
  private ERR_PAUSED = 107;
  private ERR_SHARES_NOT_SET = 109;

  private isOwner(caller: string): boolean {
    return caller === this.state.contractOwner;
  }

  private validateShares(shares: Share[]): ClarityResponse<boolean> {
    const totalPercent = shares.reduce((sum, s) => sum + s.percentage, 0);
    const allValid = shares.every(s => s.percentage > 0 && s.percentage <= this.MAX_SHARE_PERCENTAGE);
    if (
      shares.length > 0 &&
      shares.length <= this.MAX_CONTRIBUTORS &&
      totalPercent === this.MAX_SHARE_PERCENTAGE &&
      allValid
    ) {
      return { ok: true, value: true };
    }
    return { ok: false, value: this.ERR_INVALID_SHARE };
  }

  private calculatePayout(amount: number, percentage: number): number {
    return Math.floor((amount * percentage) / this.MAX_SHARE_PERCENTAGE);
  }

  private distributeToContributor(
    patentId: string,
    contributor: string,
    payout: number,
    tokenType: string | null,
    tokenTrait?: MockTokenTrait
  ): ClarityResponse<boolean> {
    if (tokenType && tokenTrait) {
      return tokenTrait.transfer(payout, "contract", contributor);
    } else {
      // Simulate STX transfer by updating balances if needed, but for mock, just record
    }
    const key = `${patentId}-${contributor}`;
    const current = this.state.contributorPayouts.get(key)?.totalReceived ?? 0;
    this.state.contributorPayouts.set(key, { totalReceived: current + payout });
    return { ok: true, value: true };
  }

  setPatentShares(
    caller: string,
    patentId: string,
    shares: Share[],
    registry: MockPatentRegistry
  ): ClarityResponse<boolean> {
    if (this.state.paused) return { ok: false, value: this.ERR_PAUSED };
    const isRegistered = registry.isPatentRegistered(patentId);
    if (!isRegistered.ok || !isRegistered.value) return { ok: false, value: this.ERR_INVALID_PATENT };
    const ownerRes = registry.getPatentOwner(patentId);
    if (!ownerRes.ok) return { ok: false, value: this.ERR_INVALID_PATENT };
    if (caller !== ownerRes.value) return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    const validate = this.validateShares(shares);
    if (!validate.ok) return validate;
    this.state.patentShares.set(patentId, { shares });
    return { ok: true, value: true };
  }

  distributeRoyalties(
    caller: string,
    patentId: string,
    amount: number,
    tokenType: string | null,
    registry: MockPatentRegistry,
    tokenTrait?: MockTokenTrait
  ): ClarityResponse<{ remaining: number; tokenType: string | null; patentId: string }> {
    if (this.state.paused) return { ok: false, value: this.ERR_PAUSED };
    const sharesOpt = this.state.patentShares.get(patentId);
    if (!sharesOpt) return { ok: false, value: this.ERR_SHARES_NOT_SET };
    const contributorsRes = registry.getPatentContributors(patentId);
    if (!contributorsRes.ok) return { ok: false, value: this.ERR_INVALID_PATENT };
    if (amount < this.MIN_DEPOSIT_AMOUNT) return { ok: false, value: this.ERR_INVALID_AMOUNT };
    const distId = this.state.distributionCounter + 1;
    this.state.distributionCounter = distId;
    this.state.distributionHistory.set(distId, {
      patentId,
      amount,
      tokenType,
      timestamp: Date.now(),
      distributor: caller,
    });
    this.state.totalDistributed += amount;
    let acc: { remaining: number; tokenType: string | null; patentId: string } = { remaining: amount, tokenType, patentId };
    for (const share of sharesOpt.shares) {
      const payout = this.calculatePayout(acc.remaining, share.percentage);
      const distributeRes = this.distributeToContributor(patentId, share.contributor, payout, tokenType, tokenTrait);
      if (!distributeRes.ok) return { ok: false, value: this.ERR_DISTRIBUTION_FAILED };
      acc.remaining -= payout;
    }
    return { ok: true, value: acc };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.isOwner(caller)) return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.isOwner(caller)) return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.paused = false;
    return { ok: true, value: true };
  }

  transferOwnership(caller: string, newOwner: string): ClarityResponse<boolean> {
    if (!this.isOwner(caller)) return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.contractOwner = newOwner;
    return { ok: true, value: true };
  }

  getPatentShares(patentId: string): ClarityResponse<{ shares: Share[] } | undefined> {
    return { ok: true, value: this.state.patentShares.get(patentId) };
  }

  getDistributionHistory(distId: number): ClarityResponse<DistributionRecord | undefined> {
    return { ok: true, value: this.state.distributionHistory.get(distId) };
  }

  getContributorPayouts(patentId: string, contributor: string): ClarityResponse<ContributorPayout | undefined> {
    const key = `${patentId}-${contributor}`;
    return { ok: true, value: this.state.contributorPayouts.get(key) };
  }

  getTotalDistributed(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalDistributed };
  }

  getContractOwner(): ClarityResponse<string> {
    return { ok: true, value: this.state.contractOwner };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getDistributionCounter(): ClarityResponse<number> {
    return { ok: true, value: this.state.distributionCounter };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  owner: "wallet_1",
  contributor1: "wallet_2",
  contributor2: "wallet_3",
  unauthorized: "wallet_4",
};

describe("RoyaltyDistributor Contract", () => {
  let contract: RoyaltyDistributorMock;
  let registry: MockPatentRegistry;
  let tokenTrait: MockTokenTrait;

  beforeEach(() => {
    contract = new RoyaltyDistributorMock();
    registry = new MockPatentRegistry();
    tokenTrait = new MockTokenTrait();
    vi.resetAllMocks();
  });

  it("should allow patent owner to set shares", () => {
    const patentId = "patent123";
    registry.setPatent(patentId, accounts.owner, [accounts.contributor1, accounts.contributor2]);

    const shares: Share[] = [
      { contributor: accounts.contributor1, percentage: 60 },
      { contributor: accounts.contributor2, percentage: 40 },
    ];

    const setShares = contract.setPatentShares(accounts.owner, patentId, shares, registry);
    expect(setShares).toEqual({ ok: true, value: true });

    const getShares = contract.getPatentShares(patentId);
    expect(getShares.ok).toBe(true);
    expect(getShares.value?.shares).toEqual(shares);
  });

  it("should prevent unauthorized user from setting shares", () => {
    const patentId = "patent123";
    registry.setPatent(patentId, accounts.owner, [accounts.contributor1]);

    const shares: Share[] = [{ contributor: accounts.contributor1, percentage: 100 }];

    const setShares = contract.setPatentShares(accounts.unauthorized, patentId, shares, registry);
    expect(setShares).toEqual({ ok: false, value: 100 });
  });

  it("should validate shares sum to 100%", () => {
    const patentId = "patent123";
    registry.setPatent(patentId, accounts.owner, [accounts.contributor1, accounts.contributor2]);

    const invalidShares: Share[] = [
      { contributor: accounts.contributor1, percentage: 50 },
      { contributor: accounts.contributor2, percentage: 40 },
    ];

    const setShares = contract.setPatentShares(accounts.owner, patentId, invalidShares, registry);
    expect(setShares).toEqual({ ok: false, value: 102 });
  });

  it("should prevent distribution when paused", () => {
    const patentId = "patent123";
    registry.setPatent(patentId, accounts.owner, [accounts.contributor1]);

    const shares: Share[] = [{ contributor: accounts.contributor1, percentage: 100 }];
    contract.setPatentShares(accounts.owner, patentId, shares, registry);

    contract.pauseContract(accounts.deployer);

    const distribute = contract.distributeRoyalties(accounts.deployer, patentId, 1000, null, registry);
    expect(distribute).toEqual({ ok: false, value: 107 });
  });

  it("should allow owner to pause and unpause", () => {
    const pause = contract.pauseContract(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const unpause = contract.unpauseContract(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent non-owner from pausing", () => {
    const pause = contract.pauseContract(accounts.unauthorized);
    expect(pause).toEqual({ ok: false, value: 100 });
  });

  it("should transfer ownership", () => {
    const transfer = contract.transferOwnership(accounts.deployer, accounts.owner);
    expect(transfer).toEqual({ ok: true, value: true });
    expect(contract.getContractOwner()).toEqual({ ok: true, value: accounts.owner });
  });

  it("should get distribution history", () => {
    const patentId = "patent123";
    registry.setPatent(patentId, accounts.owner, [accounts.contributor1]);
    const shares: Share[] = [{ contributor: accounts.contributor1, percentage: 100 }];
    contract.setPatentShares(accounts.owner, patentId, shares, registry);
    contract.distributeRoyalties(accounts.deployer, patentId, 1000, null, registry);

    const history = contract.getDistributionHistory(1);
    expect(history.ok).toBe(true);
    expect(history.value?.patentId).toBe(patentId);
    expect(history.value?.amount).toBe(1000);
  });
});