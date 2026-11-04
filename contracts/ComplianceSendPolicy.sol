// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// Purser's send policy on Metal (enterprise item 2): the business's outgoing payments are held at this contract, and
/// they leave only with a compliance decision Purser signed for exactly that payment. Metal documents this pattern
/// ("send policy contract", docs.metalntwx.com/learn/compliance/programmable-compliance): an off-chain decision,
/// signed, bound to the amount and the recipient, with an expiry and a replay record; without it the chain reverts.
///
/// The decision is EIP-712 typed data in this contract's domain (name, version, chain id, this address), so a decision
/// for another contract or chain does not verify here; the domain is recomputed if the chain id ever changes (a fork).
/// Each payment id is spent once, and Purser can cancel a decision before it is used: a cancellation the compliance
/// key signed marks the id spent. Signatures with a high s or a v other than 27/28 are refused, so a decision has one
/// valid encoding. The compliance key is fixed at deployment: rotating it means a new contract.
///
/// There is no other way out for the funds on purpose: an owner's withdrawal would be a way around the policy. A
/// production version would add a time-locked recovery the CFO's quorum controls; this one holds test money only.
interface IMip20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ComplianceSendPolicy {
    address public immutable token;
    /// Purser's compliance key: it signs a decision only after the payee passed screening.
    address public immutable complianceSigner;
    /// Who may submit a payment (the business's payer key); a decision alone cannot be used by anyone else.
    address public immutable operator;
    uint256 private immutable deployedChainId;
    bytes32 private immutable deployedDomainSeparator;

    bytes32 public constant DECISION_TYPEHASH =
        keccak256("Decision(bytes32 paymentId,address to,uint256 amount,uint64 validUntil,bytes32 screeningRef)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 paymentId)");
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    mapping(bytes32 => bool) public spent;

    event Sent(bytes32 indexed paymentId, address indexed to, uint256 amount, bytes32 screeningRef);
    event Cancelled(bytes32 indexed paymentId);

    error NotOperator();
    error DecisionExpired();
    error PaymentIdSpent();
    error BadSignature();
    error NotCleared();
    error TransferFailed();

    constructor(address token_, address complianceSigner_, address operator_) {
        token = token_;
        complianceSigner = complianceSigner_;
        operator = operator_;
        deployedChainId = block.chainid;
        deployedDomainSeparator = domainFor(block.chainid);
    }

    function domainFor(uint256 chainId) private view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("PurserComplianceSendPolicy"), keccak256("1"), chainId, address(this)
        ));
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == deployedChainId ? deployedDomainSeparator : domainFor(block.chainid);
    }

    function decisionDigest(bytes32 paymentId, address to, uint256 amount, uint64 validUntil, bytes32 screeningRef) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(DECISION_TYPEHASH, paymentId, to, amount, validUntil, screeningRef));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function cancelDigest(bytes32 paymentId) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), keccak256(abi.encode(CANCEL_TYPEHASH, paymentId))));
    }

    /// Withdraws an unused decision: the id is spent, so the decision can no longer pay. Anyone may submit a
    /// cancellation the compliance key signed; it can only stop a payment, never make one.
    function cancel(bytes32 paymentId, bytes calldata signature) external {
        if (spent[paymentId]) revert PaymentIdSpent();
        if (recover(cancelDigest(paymentId), signature) != complianceSigner) revert NotCleared();
        spent[paymentId] = true;
        emit Cancelled(paymentId);
    }

    function send(bytes32 paymentId, address to, uint256 amount, uint64 validUntil, bytes32 screeningRef, bytes calldata signature) external {
        if (msg.sender != operator) revert NotOperator();
        if (block.timestamp > validUntil) revert DecisionExpired();
        if (spent[paymentId]) revert PaymentIdSpent();
        if (recover(decisionDigest(paymentId, to, amount, validUntil, screeningRef), signature) != complianceSigner) revert NotCleared();
        spent[paymentId] = true;
        if (!IMip20(token).transfer(to, amount)) revert TransferFailed();
        emit Sent(paymentId, to, amount, screeningRef);
    }

    function recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}
