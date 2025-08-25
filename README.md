# 💊 Blockchain-based Royalty Tracking for Pharmaceutical Patents

Welcome to a revolutionary system for ensuring fair compensation in pharmaceutical R&D! This project uses the Stacks blockchain and Clarity smart contracts to transparently track contributions to patents, automate royalty distributions, and resolve disputes in collaborative drug development. It solves the real-world problem of opaque royalty sharing, where inventors and collaborators often face delays, errors, or unfair payouts due to centralized systems and complex agreements.

## ✨ Features

🔍 Register patents with detailed contributor shares  
💰 Automate royalty distributions based on verified contributions  
🤝 Manage collaborative licenses and usage rights  
⚖️ Built-in dispute resolution through on-chain voting  
📊 Immutable audit logs for transparency and compliance  
🔒 Secure token-based payouts using STX or custom tokens  
🚀 Scalable for multi-party R&D projects  

## 🛠 How It Works

**For Inventors and Collaborators**  
- Register a new patent by providing its details, contributor list, and ownership shares (e.g., percentages adding up to 100%).  
- Use the system to log contributions during R&D, which are timestamped immutably.  
- When royalties are earned (e.g., from drug sales or licensing), deposit funds into the system for automatic distribution.  

**For Licensees and Pharma Companies**  
- Query patent details to verify ownership and licensing terms.  
- Purchase or renew licenses on-chain, triggering royalty calculations.  
- View audit logs to ensure compliance with regulatory standards like FDA reporting.  

**For Dispute Resolution**  
- If a disagreement arises (e.g., over share percentages), initiate a vote among verified contributors.  
- The system enforces outcomes automatically, updating shares or distributions.  

That's it! Everything is handled transparently on the blockchain, reducing legal fees and building trust in collaborative R&D.

## 📜 Smart Contracts

This project involves 8 Clarity smart contracts to handle various aspects of the system:  

1. **PatentRegistry.clar**: Registers new patents with unique IDs, titles, descriptions, and initial contributor lists. Prevents duplicates via hash checks.  
2. **ContributorManager.clar**: Manages contributor profiles, assigns ownership shares, and updates them via authorized proposals.  
3. **RoyaltyDistributor.clar**: Calculates and distributes royalties based on shares when funds are deposited (supports STX and fungible tokens).  
4. **LicenseManager.clar**: Handles license issuance, renewals, and tracking of usage rights tied to patents.  
5. **DisputeResolver.clar**: Initiates and resolves disputes through on-chain voting mechanisms among contributors.  
6. **AuditLog.clar**: Logs all actions (registrations, distributions, disputes) immutably for auditing and compliance.  
7. **TokenIntegrator.clar**: Integrates with STX or custom tokens for secure, automated payouts.  
8. **GovernanceVoting.clar**: Facilitates broader governance decisions, like system upgrades or parameter changes, via token-weighted voting.  

These contracts interact seamlessly, ensuring the entire workflow is decentralized and tamper-proof.