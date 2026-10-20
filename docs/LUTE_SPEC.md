# Lute — The Privacy-First Programmable Payments Protocol

> Owner's product specification (the WHAT), provided by Maris on 2026-10-20. `docs/MANDATE.md` governs HOW; conflicts are logged in `docs/DECISIONS.md`.

**Tagline:** Private money. Programmable payments.
**Primary Network:** Zcash
**Core Asset:** Shielded ZEC
**Hackathon:** ZECATHON 2026
**Submission Track:** Shielded Payments
**Core Technologies:** Zcash, Zebra, Zallet, Zaino, librustzcash, ZIP-321, TypeScript, Model Context Protocol, and optional verified confidential-intent integrations.
**Product Status:** Proposed architecture. Implementation and independent privacy verification pending.

## 1. Executive Summary
Lute is a privacy-first payment and financial execution platform that makes shielded ZEC useful for everyday transactions, programmable compensation, digital commerce, subscriptions, and autonomous applications.

Lute allows people, businesses, developers, and AI agents to initiate and manage financial operations without unnecessarily publishing financial relationships, transaction amounts, or payment activity.

The platform provides:
1. Private Send and Receive.
2. Private payment requests, links, and QR codes.
3. Private merchant checkout and refunds.
4. Private group collections and expense splitting.
5. Private per-second payment streams.
6. Private usage-based and metered billing.
7. Private subscription agreements.
8. Conditional confidential cross-chain funding.
9. A reusable private financial Action protocol.
10. A developer SDK and permissioned MCP server.
11. LuteGuard, the mandatory privacy and authorization engine.

All modules operate through one shared execution architecture.

Privacy is not an optional mode. It is an architectural requirement. Lute must not knowingly execute a financial Action that violates its declared privacy policy. A feature that cannot satisfy that policy remains disabled until it can.

Lute does not promise absolute anonymity. It distinguishes information hidden from public blockchain observers from information legitimately known to transaction participants and infrastructure operators. The product's core objective is to minimize unnecessary disclosure across the entire financial lifecycle.

## 2. The Fundamental Problem
Most blockchain payment infrastructure exposes financial information that would ordinarily remain confidential. Transparent transactions can reveal:
- Wallet balances.
- Payment amounts.
- Financial relationships.
- Payment timing.
- Business cash flows.
- Compensation patterns.
- Customer spending activity.
- Transactions between related accounts.

Zcash provides technology for shielding transaction details. However, building a complete private financial application requires more than using shielded addresses. Applications can still leak private information through invoice URLs, analytics services, databases, wallet integrations, cloud logs, viewing keys, API requests, compromised devices, and external settlement providers.

Programmable payments introduce additional challenges. For example, a streaming-payment system may conceal its blockchain transfers while publicly exposing employee salaries through an ordinary application API. A subscription system may use shielded ZEC while storing readable customer identities and renewal histories. A cross-chain application may advertise private settlement even though the source-chain transfer and destination-chain withdrawal are publicly visible.

Lute is designed to address these application-level weaknesses alongside on-chain financial privacy.

## 3. Lute's Privacy Guarantee
Lute uses a strict privacy policy called LUTE STRICT. Under this policy, operations must comply with three primary requirements.

### 3.1 Private On-Chain Settlement
Supported Zcash financial transfers must use shielded transaction paths that protect transaction participants and amounts. Required controls include:
- Supported shielded Zcash receivers.
- No transparent payment outputs.
- No transparent input funding within a strict private Action.
- No automatic privacy-policy downgrade.
- No unapproved cross-pool amount disclosure.
- Explicit wallet authorization.
- Genuine transaction confirmation.

The implementation must use the strongest appropriate supported wallet privacy policy. For Zallet, this includes `FullPrivacy` for applicable same-pool shielded transactions, subject to verification against the installed wallet version.

### 3.2 Private Application Data
Financial agreements and sensitive records must not be published as readable application data. This includes:
- Customer information.
- Salary agreements.
- Contractor rates.
- Billing history.
- Group contributions.
- Subscription details.
- API consumption.
- Private receipts.
- Wallet viewing information.
- Payment references.

Lute should use end-to-end encryption wherever the relevant participants can manage the required keys. For data that must be processed by a service, Lute must document the precise trust boundary and minimize the service's access. Encryption at rest alone is not equivalent to end-to-end encryption.

### 3.3 Private Execution Infrastructure
The platform's infrastructure must not bypass its privacy requirements. Every financial execution path must pass LuteGuard before authorization, signing, or settlement. This includes transactions initiated through:
- The Lute web application.
- Mobile interfaces.
- Backend APIs.
- Background payment workers.
- The developer SDK.
- MCP agents.
- Subscription schedulers.
- Streaming settlement services.
- Metered billing integrations.
- Merchant checkout.
- Cross-chain adapters.

Lute must never allow a secondary interface to execute an operation that the main application would reject. Financial permissions must be enforced by actual authorization boundaries. An AI agent receiving instructions to respect a spending limit is not sufficient. The financial execution system itself must reject operations exceeding the authorized limit.

**Fail-closed execution.** When a transaction violates the required privacy policy, Lute must stop execution. It must not:
- Silently use a transparent address.
- Downgrade to a weaker privacy policy.
- Publish sensitive financial data.
- Substitute an unverified cross-chain route.
- Bypass LuteGuard through another API.
- Misrepresent the operation as private.

If the system cannot prove that the relevant execution conditions are satisfied, the Action remains blocked or unverified.

### 3.4 Privacy Boundaries
Lute protects against unnecessary disclosure, but cannot guarantee that all parties learn nothing. For example:
- A payer knows what they paid.
- A merchant knows the amount received.
- An employer knows an agreed compensation rate.
- A service provider may know the amount of usage it delivered.
- A group organizer may know contribution details necessary to administer the collection.

Such information must not automatically be disclosed to unrelated users, observers, or services. Lute must document which information is visible to each authorized participant.

### 3.5 Network and Metadata Privacy
Shielded Zcash payments do not automatically conceal all network activity. Observers may still learn information from:
- IP addresses.
- Transaction timing.
- Network activity.
- Publicly shared links.
- Browser requests.
- Third-party services.
- Cross-chain transactions.
- Insecure logs.
- Compromised devices.

Lute should minimize these risks through careful infrastructure design, but must disclose residual limitations.

## 4. The Lute Product Architecture
Lute consists of interconnected modules operating through a shared Actions and settlement engine.

**Core Product Modules**
- **Lute Wallet:** Private Send, Receive, balances, and activity.
- **Lute Actions:** Programmable financial operations distributed through links, QR codes, applications, and APIs.
- **Lute Commerce:** Private merchant payments, invoices, receipts, and refunds.
- **Lute Groups:** Private group collections and expense splitting.
- **Lute Streams:** Per-second payment accrual and authorized shielded settlement.
- **Lute Meter:** Usage-based billing for digital services, APIs, compute, and timed access.
- **Lute Subscriptions:** Recurring private payment agreements.
- **Lute Cross-Chain:** Conditionally supported confidential funding routes.
- **LuteGuard:** Privacy, authorization, and financial-integrity enforcement.
- **Lute SDK:** Developer access to supported financial capabilities.
- **Lute MCP:** Permission-controlled access for AI agents.

All these modules use the same underlying Action lifecycle:
**Create → Validate → Authorize → Execute → Confirm → Reconcile**

No product module should implement an alternative payment path that bypasses the shared privacy policy.

## 5. Lute Wallet — Private Send and Receive
The wallet is the foundation of the consumer experience. Advanced financial features must never replace basic sending and receiving.

### 5.1 Send
Users can send ZEC through a compatible shielded wallet.

**User flow**
1. Open Lute.
2. Select Send.
3. Enter a recipient address or scan a QR code.
4. Enter the payment amount.
5. Optionally add a shielded memo.
6. Review the transaction.
7. LuteGuard validates the requested operation.
8. The wallet authorizes and signs the transaction.
9. The transaction is broadcast to Zcash.
10. Lute tracks confirmation.
11. The final payment status appears in the activity feed.

**Privacy requirements**
- Validate the actual recipient type.
- Enforce supported shielded transfers.
- Reject transparent fallbacks.
- Avoid unintended cross-pool value disclosure.
- Protect private memos.
- Never expose spending keys.
- Do not log sensitive transaction contents.
- Do not represent broadcast as confirmed settlement.

### 5.2 Receive
Users can receive shielded ZEC through a wallet-controlled receiving address.

**Features**
- Generate a supported shielded-only receiving address.
- Display a QR code.
- Copy the receiving address.
- Share supported payment instructions.
- Request a specified amount.
- View incoming payments.
- Track wallet synchronization and confirmations.
- Generate fresh receiving addresses where supported.

Lute must never assume that a Unified Address contains only shielded receivers. The wallet adapter must inspect supported receiver types and apply the appropriate policy.

### 5.3 Wallet Dashboard
The wallet displays:
- Confirmed spendable ZEC.
- Pending incoming payments.
- Pending outgoing payments.
- Shielded transaction history.
- Network status.
- Wallet synchronization status.
- Transaction fees.
- Optional fiat equivalents from a verified price source.

Streaming earnings must appear separately from spendable wallet funds.

### 5.4 Wallet Custody
The preferred user experience is non-custodial. The user's spending authority should remain with the user's wallet or another clearly authorized signing arrangement. If any implementation uses a locally hosted wallet service, Lute must disclose who controls the keys. The application must not claim to be non-custodial when its backend has unrestricted access to user funds.

## 6. Lute Actions — Programmable Private Payments
Lute Actions is the central protocol connecting all financial workflows. An Action is a structured representation of a supported operation. Examples include:
- Send a payment.
- Request money.
- Pay an invoice.
- Contribute to a collection.
- Create a streaming agreement.
- Start a metered service.
- Renew a subscription.
- Request a refund.
- Propose an agent payment.
- Request an approved cross-chain funding route.

### 6.1 Action Structure
An Action should define:
- Unique Action ID.
- Action category.
- Supported network.
- Relevant asset.
- Amount or pricing rules.
- Recipient or authorized destination.
- Privacy policy.
- Authorization requirements.
- Expiration.
- Execution state.
- Settlement reference.
- Confirmation requirements.

Sensitive Action information must not automatically be placed in public URLs.

### 6.2 Payment Links and QR Codes
Lute allows users to distribute supported Actions through:
- Direct links.
- QR codes.
- Messaging applications.
- Websites.
- Developer applications.

Where possible, links should use opaque identifiers and protected Action data. A public payment link must not accidentally expose confidential salary records, customer information, or private billing descriptions.

ZIP-321 may be used for supported wallet-compatible payment requests. The system must not confuse privacy of the eventual Zcash transaction with secrecy of the payment-request URI itself.

### 6.3 Action Verification
An Action is successful only when the expected operation has actually completed. Payment Actions must have real settlement evidence. Lute must distinguish:
- Created.
- Validated.
- Awaiting authorization.
- Authorized.
- Submitted.
- Pending confirmation.
- Confirmed.
- Failed.
- Expired.
- Rejected.

A database record saying "paid" is not sufficient proof of blockchain settlement.

## 7. Lute Commerce — Private Checkout and Refunds
Lute Commerce enables businesses and creators to accept shielded ZEC payments.

### 7.1 Merchant Checkout
A merchant creates a payment request for a product or service. The customer receives a private checkout link or QR code. The customer authorizes a shielded payment. The merchant verifies payment using an appropriately authorized wallet or payment-verification mechanism. Lute updates the invoice only after the necessary confirmation.

**Capabilities**
- Payment requests.
- Unique invoices.
- Expiration.
- Payment verification.
- Duplicate-payment protection.
- Merchant receipts.
- Refund requests.
- Reconciliation.
- Payment-status tracking.

### 7.2 Private Receipts
Lute generates authenticated receipts for completed payments. Receipts may contain:
- Invoice reference.
- Confirmed amount.
- Merchant identity or signature.
- Payment status.
- Timestamp.
- Refund eligibility.
- Relevant encrypted information.

Access must be restricted to authorized parties. A merchant-signed receipt is an attestation by the merchant, not automatically an independently verifiable zero-knowledge proof.

### 7.3 Private Refunds
Refunds are new shielded payments.

**Flow**
1. Customer submits an authenticated refund request.
2. Merchant verifies the original payment.
3. Lute checks the refund policy.
4. Duplicate-refund protection runs.
5. Customer provides a supported shielded receiving address.
6. Merchant authorizes the refund.
7. LuteGuard validates the operation.
8. A new shielded payment is sent.
9. The recipient verifies settlement.
10. The refund record is updated.

Lute must not claim that finalized Zcash transactions can simply be reversed.

## 8. Lute Groups — Private Collections and Expense Splitting
Lute Groups allows people to coordinate payments without broadcasting their financial activity on the blockchain.

**Supported Use Cases**
- Splitting bills.
- Group gifts.
- Community contributions.
- Shared purchases.
- Team expenses.
- Collaborative subscriptions.
- Private fundraising collections.

**Example.** Five friends want to contribute 5 ZEC toward a shared purchase. One person creates a group collection. Lute generates a private collection Action. Each participant receives payment instructions. Participants send shielded ZEC. The organizer's authorized wallet confirms incoming contributions. The collection progress updates as payments are verified.

**Privacy Requirements**
- Contribution records are accessible only to authorized users.
- Individual payment details are not automatically revealed to other group members.
- Public blockchain observers cannot read shielded contribution amounts and addresses.
- Group membership is not published through public APIs.
- Private contribution data is protected in logs and databases.
- The organizer's legitimately required visibility is documented.

Where supported, Lute may allow participants to contribute pseudonymously. It must not promise organizer-blind collection if the implementation reveals contribution identities to the organizer.

## 9. Lute Streams — Per-Second Private Payments
Lute Streams supports time-based financial agreements where compensation accumulates continuously.

**Use Cases**
- Freelancer compensation.
- Contractor payments.
- Employee salaries.
- Consulting.
- Creator retainers.
- Professional services.
- Long-term service agreements.

### 9.1 Creating a Stream
A payer establishes:
- Recipient.
- Total budget.
- Payment asset.
- Start timestamp.
- End timestamp or duration.
- Rate per second.
- Settlement conditions.
- Cancellation rules.
- Authorized spending arrangement.
- Privacy requirements.

### 9.2 Per-Second Accrual
Lute calculates earnings according to elapsed time. For example, a freelancer earns 1 ZEC over 24 hours. The application calculates the fraction earned after each second. The interface can show accrued earnings increasing continuously.

The authoritative calculation must use integer zatoshi values and deterministic rounding. Frontend animations must not determine actual financial balances.

### 9.3 Stream Dashboard
Display:
- Total agreement value.
- Earnings rate.
- Accrued amount.
- Amount authorized for settlement.
- Pending payout.
- Confirmed paid amount.
- Outstanding amount.
- Remaining budget.
- Start and end times.
- Agreement status.

### 9.4 Shielded Settlement
Continuous accrual does not mean a Zcash transaction occurs every second. The initial implementation can support authorized periodic settlements or payer-approved payout requests. Each actual transfer must be shielded and verified. The system must clearly distinguish earned amounts from funds that the recipient can actually spend.

### 9.5 Trustless Streaming Research
The long-term goal is to investigate whether recipients can independently claim earned funds without needing the payer's ongoing cooperation. Possible approaches include cryptographic payment channels or appropriately enforceable funding arrangements.

However, Lute must not claim that funds are locked or independently claimable unless a real protocol enforces those guarantees. An ordinary scheduler is not trustless streaming. A live balance counter is not a cryptographic payment channel. A payer-controlled wallet can stop paying unless a separate enforcement mechanism prevents it. This limitation must be disclosed.

## 10. Lute Meter — Private Usage-Based Billing
Lute Meter enables payments based on consumption rather than fixed upfront fees.

**Supported Use Cases**
- AI API access.
- Developer APIs.
- Cloud compute.
- Data services.
- Video sessions.
- Live education.
- Professional consultations.
- Timed software access.

### 10.1 Billing Models
Lute aims to support:
- Per-second billing.
- Per-minute billing.
- Per-request billing.
- Per-token billing.
- Per-compute-unit billing.
- Per-session billing.

### 10.2 Metered Payment Flow
1. Provider creates a metered service.
2. Customer reviews the price.
3. Customer authorizes a spending cap.
4. A metered session begins.
5. The service produces authenticated usage records.
6. Lute calculates charges.
7. Budget enforcement runs.
8. An authorized settlement is initiated.
9. Shielded ZEC is transferred.
10. Settlement is verified.
11. The customer receives a private receipt.

### 10.3 Financial Integrity
The system requires:
- Authenticated usage events.
- Unique event identifiers.
- Replay protection.
- Duplicate-event rejection.
- Price-version verification.
- Spending caps.
- Session expiration.
- Reconciliation.
- Correct handling of failed settlements.

Lute must distinguish provider-reported usage from independently verified consumption.

### 10.4 Meter Privacy
Lute must avoid exposing:
- Customer identities.
- Private prompts.
- API contents.
- Detailed usage history.
- Sensitive service descriptions.
- Billing relationships.

Metering data should be minimized and accessible only to the parties that legitimately need it.

## 11. Lute Subscriptions — Private Recurring Payments
Lute Subscriptions provides recurring payment agreements using shielded ZEC.

**Supported Examples**
- Creator memberships.
- Premium newsletters.
- AI API subscriptions.
- Software subscriptions.
- Private communities.
- Recurring donations.
- Research memberships.
- Business service retainers.

**Subscription Flow**
1. Merchant creates a subscription plan.
2. Customer reviews the billing terms.
3. Customer accepts the agreement.
4. Lute creates a payment request.
5. Customer authorizes the shielded payment.
6. Merchant verifies settlement.
7. Access is activated.
8. The next billing period generates a renewal request.
9. Renewal succeeds after the next verified payment.

**Automatic Billing Limitations.** The initial model should use customer-authorized renewal payments. Automatically generating the next invoice is not the same as automatically debiting a shielded wallet. True automatic payments require a suitable wallet signing and authorization mechanism. If Lute later adds automatic renewals, the implementation must enforce spending limits, expiration, revocation, and other relevant permissions. The system must not give an application unrestricted control over customer funds merely to enable subscriptions.

**Subscription Privacy.** Private subscription data includes:
- Customer identity.
- Membership information.
- Payment history.
- Renewal periods.
- Pricing plans.
- Access entitlements.

These records must not be exposed through public APIs, URLs, or third-party analytics.

## 12. Lute Cross-Chain — Confidential Intents
Lute Cross-Chain aims to make private Zcash payments accessible through supported external funding routes. The intended use case is allowing customers to finance a shielded ZEC payment without first manually acquiring ZEC.

However, cross-chain confidentiality is a substantial technical challenge. A confidential intent is not automatically an end-to-end private cross-chain transaction.

### 12.1 NEAR Confidential Intents
NEAR Confidential Intents can provide confidentiality for parts of the intent execution process. That does not automatically conceal activity occurring on public source or destination blockchains. For example, a USDC transfer from Base may expose:
- Source wallet.
- Transferred amount.
- Transaction time.
- Token contract.
- Recipient or settlement contract.

A subsequent shielded ZEC payment cannot erase the existing public Base transaction record.

### 12.2 Strict Cross-Chain Requirements
Lute must investigate the actual route before enabling it. Required checks include:
- Source-chain privacy.
- Destination-chain privacy.
- Intermediate execution visibility.
- Solver access to order information.
- Provider visibility.
- Deposit-address type.
- Withdrawal-address type.
- Transparent Zcash hops.
- Quote handling.
- Settlement confirmation.
- Refund and failure behavior.
- Metadata correlation.

### 12.3 Cross-Chain Policy
LuteGuard classifies each proposed route. Possible classifications:
- Verified strict-private route.
- Confidential intermediate execution only.
- Public source-chain exposure.
- Public destination-chain exposure.
- Transparent Zcash hop.
- Provider-visible confidential data.
- Unverified route.
- Unsupported route.

Only routes actually satisfying LUTE STRICT may execute through the strict-private interface. Unknown or unsupported routes remain disabled.

### 12.4 Proposed Cross-Chain Flow
1. Customer opens an eligible Lute Action.
2. Lute requests available route information.
3. LuteGuard evaluates the route.
4. Unsupported or privacy-unsafe routes are rejected.
5. An eligible route returns a quote.
6. Customer reviews the financial and privacy conditions.
7. Customer authorizes execution.
8. The system tracks external settlement.
9. Recipient-side verification confirms actual shielded ZEC delivery.
10. The Action is marked complete only after all required conditions hold.

### 12.5 Cross-Chain Release Condition
Cross-chain functionality is part of the complete architecture. However, the executable integration remains disabled until a genuine supported route passes the applicable privacy tests. Lute must not fake swaps, bridges, or confidential settlements. A public-chain funding route cannot be described as end-to-end private merely because it finishes with shielded ZEC.

## 13. LuteGuard — The Privacy Enforcement Engine
LuteGuard is the most important infrastructure component in Lute. Its purpose is to enforce privacy, authorization, and financial integrity across every application module. LuteGuard is not a decorative privacy badge. It is part of the financial execution path.

### 13.1 Transaction Policy
Validates:
- Network.
- Receiver type.
- Shielded transaction requirements.
- Value-pool compatibility.
- Input privacy.
- Output privacy.
- Wallet policy.
- Transaction parameters.
- Signing conditions.

### 13.2 Metadata Policy
Protects sensitive information from:
- Public URLs.
- Browser history.
- Server logs.
- Application analytics.
- Error messages.
- Link previews.
- Notifications.
- Unnecessary third-party services.

### 13.3 Authorization Policy
Checks:
- Authenticated identity.
- Authorized financial operation.
- Spending budget.
- Transaction amount.
- Recipient restrictions.
- Expiration.
- Revocation.
- Approval requirements.

### 13.4 Agreement Policy
Validates:
- Stream budgets.
- Accrual rates.
- Agreement duration.
- Subscription terms.
- Metered usage.
- Cancellation rights.
- Settlement limits.

### 13.5 Settlement Policy
Protects against:
- Duplicate payments.
- Replayed requests.
- Incorrect settlement amounts.
- Stale authorization.
- Invalid state transitions.
- Double refunds.
- Incorrect payment confirmation.

### 13.6 Integration Policy
Ensures external systems cannot weaken the required privacy guarantees. This includes:
- SDK clients.
- MCP agents.
- Wallet adapters.
- Cross-chain providers.
- Merchant integrations.
- Background jobs.

### 13.7 Mandatory Execution Gate
Every financial operation must pass the applicable LuteGuard checks. A denied operation must not be executable through another endpoint. Privacy approval should be bound to the exact transaction or Action parameters that were inspected. If those parameters change, the operation must be checked again.

### 13.8 Privacy Evidence
LuteGuard should produce structured privacy decisions containing:
- Action reference.
- Policy version.
- Result.
- Rejection reason where applicable.
- Relevant non-secret evidence.
- Evaluation timestamp.

Sensitive transaction information must not be unnecessarily placed into audit records. A passing LuteGuard decision is evidence that specified checks passed. It is not proof of absolute anonymity.

## 14. Lute SDK — Developer Infrastructure
The Lute SDK makes supported Lute functionality reusable by external applications. The initial target is a TypeScript SDK.

**Proposed Modules**
- Wallet operations.
- Shielded payments.
- Payment requests.
- Actions.
- Streaming agreements.
- Metering.
- Subscriptions.
- Group collections.
- Merchant commerce.
- Settlement verification.
- LuteGuard policies.
- Approved cross-chain routes.

**Core SDK Requirements**
- Strong TypeScript typing.
- Input validation.
- Explicit network selection.
- Structured errors.
- Clear transaction states.
- Authentication.
- Authorization.
- Privacy-policy enforcement.
- Idempotency.
- Wallet integration.
- Documented settlement semantics.
- Reproducible examples.
- Automated tests.

**Developer Example.** A developer should be able to:
1. Initialize the SDK.
2. Create a supported payment request.
3. Validate its privacy requirements.
4. Coordinate wallet authorization.
5. Submit a real shielded payment.
6. Verify actual settlement.
7. Retrieve an appropriately scoped receipt.

The SDK must use the same execution engine as Lute's main application. It must not maintain a separate unrestricted signing path. Planned methods must remain unavailable or clearly marked experimental until genuinely implemented.

## 15. Lute MCP — Private Payments for AI Agents
Lute provides a Model Context Protocol server so authorized AI applications can interact with supported financial workflows.

**Potential Capabilities.** An agent can:
- Read an authorized wallet status.
- Create a payment-request draft.
- Inspect an Action.
- Propose a streaming agreement.
- Retrieve accrued earnings.
- Start an approved metered session.
- Request settlement.
- Verify transaction status.
- Check a privacy policy.
- Review authorized subscription information.

**Proposed MCP Tools**
- `lute_get_wallet_status`
- `lute_create_payment_request`
- `lute_get_action_status`
- `lute_create_stream_proposal`
- `lute_get_stream_earnings`
- `lute_create_meter_session`
- `lute_get_meter_session`
- `lute_propose_settlement`
- `lute_verify_settlement`
- `lute_privacy_check`

These are proposed tool names, not claims about deployed endpoints.

**Agent Permission Model.** Each agent requires:
- Authenticated identity.
- Explicit authorization.
- Allowed operations.
- Allowed resources.
- Budget limits where relevant.
- Per-operation limits.
- Expiration.
- Revocation.
- Approval requirements.

Read-only tools and financial proposals should be the default. An AI agent must never receive unrestricted spending authority simply because it has access to Lute MCP.

**Privacy Requirements.** The MCP server must not expose:
- Spending keys.
- Seed phrases.
- Broad viewing keys.
- Other users' financial histories.
- Unauthorized group records.
- Private memos.
- Protected billing data.

MCP execution must pass the same LuteGuard policies as ordinary users and developers. An unauthorized financial request must be rejected by enforceable application or wallet controls, not merely by an AI instruction.

## 16. Lute Dashboard — Complete Product Experience
Lute should look and behave like a polished financial application, not a technical demo.

### 16.1 Design Direction
- **Primary background:** Near black.
- **Accent:** Violet `#7835FF`.
- **Style:** Minimal, professional, subtly glassy, responsive.

Use:
- Strong typography.
- Generous spacing.
- Clean cards.
- Clear payment states.
- Restrained animation.
- Accessible contrast.
- Readable financial figures.
- Consistent icons.

Avoid excessive gradients, unnecessary decorative graphics, and fake dashboard statistics.

### 16.2 Main Navigation
The desktop sidebar contains:
1. Overview.
2. Send.
3. Receive.
4. Payment Requests.
5. Streams.
6. Meter.
7. Subscriptions.
8. Groups.
9. Commerce.
10. Cross-Chain.
11. Actions.
12. Activity.
13. Developers.
14. Privacy Center.
15. Settings.

On mobile, prioritize Overview, Send, Receive, Activity, and More.

### 16.3 Main Dashboard
**Wallet Overview.** The main card displays:
- Confirmed ZEC balance.
- Fiat equivalent where supported.
- Pending balance.
- Wallet status.
- Network.

Directly underneath are four prominent buttons: **Send | Receive | Request | Start Stream**

**Summary Cards**
- **Streaming Earnings:** Accrued, pending and settled amounts.
- **Active Meter Sessions:** Current billable usage.
- **Subscriptions:** Active plans and upcoming renewals.
- **Privacy Status:** Relevant verified policy checks and unresolved limitations.

**Activity Feed.** The main activity feed displays:
- Sent payments.
- Received payments.
- Stream settlements.
- Meter payments.
- Subscription renewals.
- Group contributions.
- Merchant refunds.

Only appropriately authorized financial details should be visible.

### 16.4 Streams Dashboard
Display individual payment agreements with:
- Payer or recipient information appropriate to the viewer.
- Payment rate.
- Accrued earnings.
- Confirmed received funds.
- Outstanding amounts.
- Agreement duration.
- Settlement history.
- Pause and cancellation controls.

The live counter is a financial estimate derived from the agreement, not wallet funds.

### 16.5 Meter Dashboard
Display:
- Active sessions.
- Service name.
- Authorized budget.
- Current accepted usage.
- Current charge.
- Time elapsed.
- Remaining authorized budget.
- Session stop control.
- Settlement history.

### 16.6 Privacy Center
The Privacy Center shows the verification status of implemented modules. It includes:
- Privacy policy version.
- Test results.
- Enabled execution paths.
- Unsupported operations.
- Known limitations.
- Review evidence.
- Recent denied financial Actions.

Do not hardcode passing test badges. Privacy status must derive from actual test results and documented verification.

## 17. Technical Architecture
Lute uses a modular architecture with a shared financial execution engine.

### 17.1 Frontend
A TypeScript/React application, with Next.js as a candidate framework. Responsibilities:
- Consumer dashboard.
- Financial Action interfaces.
- Wallet connectivity.
- Streaming visualization.
- Metered sessions.
- Payment requests.
- Privacy Center.
- Developer experience.

The frontend must not be the authoritative security or financial enforcement layer.

### 17.2 Backend
A TypeScript API service, with Fastify as a candidate framework. Responsibilities:
- Action coordination.
- Authentication.
- Authorization.
- Agreement accounting.
- Meter-event validation.
- Payment reconciliation.
- Privacy-policy coordination.
- API access.
- Background processing.

### 17.3 Database
PostgreSQL with an appropriate typed data-access layer. Responsibilities:
- Non-secret Action metadata.
- Agreement state.
- Payment reconciliation.
- Idempotency records.
- Permission records.
- Encrypted financial records where necessary.
- Privacy decisions.
- Feature evidence references.

Sensitive records must not be stored unnecessarily.

### 17.4 Zcash Integration
Use current supported components:
- Zebra for node functionality.
- Zallet for relevant wallet operations.
- Zaino where indexing support is required.
- librustzcash for supported protocol functionality.
- ZIP-321 for compatible payment requests.

Verify actual version compatibility before implementation. Use local regtest for early deterministic testing.

### 17.5 Settlement Engine
The settlement engine coordinates:
- Payment preparation.
- Wallet authorization.
- Privacy validation.
- Transaction submission.
- Confirmation.
- Reconciliation.
- Retry handling.
- Duplicate-payment prevention.

### 17.6 Agreement Engine
Handles:
- Stream contracts and accounting.
- Subscription periods.
- Metering rules.
- Payment schedules.
- Cancellation.
- Budget exhaustion.
- Outstanding liabilities.

### 17.7 Developer Interfaces
The SDK and MCP server must call the same validated execution services. Neither may bypass authorization or privacy controls.

## 18. Security and Financial Integrity

### 18.1 Fund Protection
Ordinary user signing keys must remain under appropriate user or wallet control. Do not expose wallet secrets to browser code, telemetry, or AI agents. Any automated signing arrangement requires a documented trust model and appropriately restricted authority.

### 18.2 Exact Accounting
Represent ZEC financial amounts in integer zatoshi. Avoid floating-point accounting. Use deterministic rounding. Ensure streaming and metered calculations cannot exceed authorized budgets.

### 18.3 Idempotency
Repeated execution requests must not create duplicate payments. Financial operations require stable identifiers and appropriate uniqueness constraints.

### 18.4 Settlement Accuracy
Distinguish:
- Requested.
- Authorized.
- Submitted.
- Pending.
- Confirmed.
- Received.
- Reconciled.

Never report a submitted transaction as settled without actual confirmation evidence.

### 18.5 Access Control
Enforce record-level access across all modules. Prevent users, merchants, groups, and agents from viewing unrelated financial information.

### 18.6 Logging
Operational logging must not expose wallet secrets or sensitive customer records. Use redacted and minimized audit events.

### 18.7 Privacy Limitations
Maintain explicit documentation of:
- Network-level metadata.
- Provider trust assumptions.
- Counterparty visibility.
- Hosted wallet risks.
- Third-party integration exposure.
- Timing correlations.
- Unsupported privacy guarantees.

## 19. Privacy Testing and Verification
Lute requires a reproducible privacy test suite. Every executable module must be reviewed against its specific threat model.

### 19.1 Wallet Tests
- Reject transparent recipients.
- Validate Unified Address receivers.
- Reject privacy-policy downgrade.
- Detect prohibited cross-pool disclosures.
- Verify genuine shielded transfers.
- Confirm recipient-side receipt.
- Ensure wallet secrets remain protected.

### 19.2 Application Tests
- Detect private information in URLs.
- Detect sensitive data in logs.
- Reject unauthorized API access.
- Verify encrypted data boundaries.
- Reject cross-user financial record access.
- Test receipts and private memos.
- Verify payment-request access rules.

### 19.3 Stream Tests
- Correct per-second accounting.
- Correct budget limits.
- No fractional accounting errors.
- Correct cancellation.
- Correct pause and resume behavior.
- No duplicate settlement.
- No fabricated available balance.
- Correct behavior when the payer goes offline.

### 19.4 Meter Tests
- Authenticated usage records.
- No duplicate billing.
- Budget enforcement.
- Rejected forged usage.
- Correct settlement.
- No unauthorized customer-data disclosure.

### 19.5 Group and Subscription Tests
- Protected participant information.
- No unauthorized contribution access.
- Private subscription history.
- No duplicate subscription billing.
- Correct access-entitlement expiration.

### 19.6 Cross-Chain Tests
- Detect public source-chain exposure.
- Detect public destination-chain exposure.
- Detect transparent Zcash hops.
- Verify actual route behavior.
- Verify provider visibility.
- Reject unsupported privacy claims.
- Reject unsafe fallback.
- Verify genuine destination settlement.

### 19.7 SDK and MCP Tests
- Unauthorized agent spending fails.
- Unauthorized financial data access fails.
- Agent budget overflow fails.
- Secret access fails.
- LuteGuard cannot be bypassed.
- Transaction authorization cannot be replayed.
- SDK requests use the shared privacy engine.

### 19.8 Evidence Standard
Each important test must record:
- The property tested.
- The environment.
- Expected behavior.
- Actual behavior.
- Result.
- Reproducible evidence.
- Relevant code revision.

Tests based only on mocks cannot establish that real shielded settlement works. Automated tests reduce risk but do not prove complete privacy or eliminate the need for security review.

## 20. Product Development Roadmap
Lute's complete architecture is the long-term product vision. The ZECATHON implementation should follow strict proof gates.

**Phase 1 — Genuine Shielded Payments.** Build: Zcash regtest environment; supported wallet integration; shielded Send; shielded Receive; payment requests; ZIP-321 where compatible; settlement confirmation; core LuteGuard enforcement.
*Release gate:* A genuine shielded transaction succeeds, recipient verification works, and unsafe alternatives are rejected.

**Phase 2 — Lute Actions and Commerce.** Build: shared Action lifecycle; private payment links; checkout; receipts; refunds; reconciliation; authorization checks.
*Release gate:* Real private payment workflows operate end to end without bypassing LuteGuard.

**Phase 3 — Programmable Payments.** Build: per-second stream accounting; authorized shielded stream payouts; metered sessions; spending caps; agreement privacy; accurate settlement state.
*Release gate:* At least one complete stream and metered payment workflow uses genuine shielded settlement with passing privacy tests.

**Phase 4 — Additional Financial Workflows.** Build where feasible: subscriptions; group collections; recurring payment requests; additional merchant functionality.
*Release gate:* Each enabled module passes its own functionality, confidentiality, and access-control tests.

**Phase 5 — Developer Infrastructure.** Build: TypeScript SDK; MCP server; sample integrations; agent authorization tests; documentation.
*Release gate:* External sample clients can use real supported Lute operations without bypassing LuteGuard.

**Phase 6 — Verified Cross-Chain and Advanced Channels.** Research and implement where credible: confidential-intent adapters; private route classification; supported cross-chain settlement; cryptographically enforceable payment-channel designs.
*Release gate:* No cross-chain or independently enforceable streaming claim is made without actual implementation evidence.

## 21. ZECATHON Submission Strategy
**Track:** Shielded Payments.
**Deadline:** October 28, 2026, at 23:59 UTC (October 29, 00:59 Nigeria time).

Lute's submission should focus on its strongest working private-payment journey.

**Proposed Demonstration**
1. Open the Lute dashboard.
2. Show a genuine supported Zcash wallet.
3. Create a private payment request.
4. Send shielded ZEC.
5. Verify receipt.
6. Create a streaming agreement.
7. Demonstrate per-second earnings accrual.
8. Complete an authorized shielded settlement.
9. Show the separation between earned and received funds.
10. Demonstrate a metered service.
11. Use the SDK to interact with a supported Action.
12. Use an MCP tool to propose or inspect a payment.
13. Attempt a prohibited operation.
14. Show LuteGuard rejecting the request.
15. Display recorded privacy-test evidence.

The final video should prioritize a small number of decisive demonstrations rather than rushed coverage of every module.

**Submission Deliverables.** Prepare:
- Project description.
- Public open-source repository.
- Reproducible setup instructions.
- Working application or demonstrable development environment.
- Demo link where available.
- Two-minute video.
- Privacy and architecture documentation.
- Test evidence.
- Honest implementation status.
- Relevant protocol and library attributions.

Confirm all submission requirements against the official ZECATHON portal before submission.

## 22. Feature Release Classification
Every module must receive a clear status.
- **PROVEN:** End-to-end behavior works in the declared environment, relevant privacy tests pass, and evidence exists.
- **PARTIAL:** Some implementation works, but requirements or guarantees remain unverified.
- **BLOCKED:** An essential requirement or privacy property fails.
- **ROADMAP:** Not implemented or intentionally postponed.

Only PROVEN features may be presented as fully working. Partial or unsafe financial functionality must not remain executable through hidden routes, APIs, or agent tools. A successful regtest demonstration must not be misrepresented as mainnet production readiness.

## 23. Competitive Differentiation
Lute must not claim to have invented ordinary shielded payments, payment links, subscriptions, or developer payment SDKs. Its intended differentiator is the combination of:
1. Genuine shielded Zcash settlement.
2. Private application-level financial workflows.
3. Per-second programmable compensation.
4. Usage-based billing.
5. One reusable Action execution system.
6. Mandatory privacy and authorization enforcement.
7. Developer and agent integrations governed by the same policy.
8. Reproducible evidence showing what is and is not protected.

The strongest submission is not the one with the most features. It is the one demonstrating that complex financial workflows can use shielded Zcash without accidentally exposing protected information through the surrounding application.

## 24. Long-Term Vision
Lute aims to become a programmable execution and coordination layer for private financial activity.

Individuals should be able to send and receive private payments as naturally as using an ordinary financial app. Freelancers should be able to earn according to time-based agreements while keeping payment details confidential. Creators should be able to offer private subscriptions and metered content. Businesses should be able to coordinate confidential payments and compensation. Developers should be able to integrate shielded settlement without rebuilding the entire payment lifecycle. AI agents should be able to propose or execute narrowly authorized financial operations without receiving unrestricted access to user funds.

Over time, Lute may support more sophisticated confidential interoperability and cryptographically enforceable streaming mechanisms. Every extension must remain subject to the same privacy standards. The platform's value comes from making financial privacy practical, understandable, and reusable.

## 25. Final Product Description
Lute is a privacy-first programmable payments protocol built on Zcash, designed to make shielded money useful for everyday payments, streaming compensation, metered services, recurring billing, and developer applications.

It connects ordinary Send and Receive with private payment requests, merchant checkout, group collections, subscriptions, and programmable financial agreements.

Lute Streams supports per-second earnings accounting and genuine authorized shielded settlement, while Lute Meter enables usage-based billing for digital services.

A shared Actions engine coordinates transaction preparation, authorization, execution, confirmation, and reconciliation.

LuteGuard enforces privacy and financial policies across the application, SDK, API services, and MCP tools.

Optional cross-chain integrations are enabled only when the real route satisfies the declared privacy policy.

Lute distinguishes on-chain confidentiality from application confidentiality, infrastructure visibility, and counterparty disclosures. It does not assume that every transaction is private simply because Zcash is involved.

The long-term objective is to provide a reusable foundation for private financial applications without compromising correctness or misrepresenting what the underlying technology can guarantee.

Lute's mission is to make private money usable, programmable, and accessible to people, businesses, developers, and autonomous applications.

**Lute — Private money. Programmable payments.**

*End of complete product specification.*
