// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Purser's invoice token on Metal testnet (prototype, test money only). One token per invoice.
///
/// An invoice becomes a token only after the debtor's CFO approved its exact terms with a passkey (Face ID) in Purser:
/// Purser's issuer key mints it, and Purser checks that approval in its ledger before it signs the mint. The token
/// carries hashes and amounts, never names or bank details: the document hash and the signed-terms hash let anyone
/// holding the invoice and the ledger check it against the chain, and the debtor and creditor references are keyed
/// hashes only Purser can recompute.
///
/// The token is minted to the creditor (the supplier). The creditor can offer it to a financier at a discount; the
/// financier pays the advance and receives the token in one transaction. When the invoice is due, the debtor's paying
/// wallet settles it: the face value goes to whoever holds the token then, and the token is burned. An invoice (its
/// document hash) and a signed approval (its terms hash) can each be tokenized once, also after settlement.
///
/// This is a prototype on a testnet: no legal transfer of a claim, no recourse terms, no pricing model, no compliance
/// checks on holders. The financier in Purser's runs is simulated.
contract PurserInvoiceToken is ERC721 {
    using SafeERC20 for IERC20;

    struct Invoice {
        bytes32 documentHash; // SHA-256 of the invoice document
        bytes32 termsHash; // SHA-256 of the terms the debtor's CFO signed with a passkey
        uint256 amountMinor; // the invoice amount in minor units (cents) of `currency`
        bytes3 currency; // ISO 4217 code of the invoice
        uint256 faceValue; // what settlement pays, in base units of `token`
        uint64 dueDate; // unix seconds
        bytes32 debtorRef; // keyed hash, no personal data
        bytes32 creditorRef; // keyed hash, no personal data
        address payer; // the debtor's paying wallet: only it settles
        bool settled;
    }

    struct Offer {
        address financier;
        uint256 price;
    }

    IERC20 public immutable token;
    address public immutable issuer;

    mapping(uint256 => Invoice) private invoices;
    mapping(uint256 => Offer) private offers;
    mapping(bytes32 => bool) public termsUsed;

    event Minted(uint256 indexed tokenId, address indexed creditor, bytes32 termsHash, uint256 faceValue, uint64 dueDate);
    event Offered(uint256 indexed tokenId, address indexed financier, uint256 price);
    event Financed(uint256 indexed tokenId, address indexed seller, address indexed financier, uint256 price);
    event Settled(uint256 indexed tokenId, address indexed holder, uint256 faceValue);

    error NotIssuer();
    error BadInvoice();
    error AlreadyTokenized();
    error TermsAlreadyUsed();
    error NotHolder();
    error BadOffer();
    error NoOffer();
    error PriceChanged();
    error NotPayer();
    error AlreadySettled();

    constructor(IERC20 settlementToken, address issuer_) ERC721("Purser invoice (testnet prototype)", "PINV") {
        token = settlementToken;
        issuer = issuer_;
    }

    /// The token id of an invoice is its document hash, so one document gives one token.
    function tokenIdOf(bytes32 documentHash) public pure returns (uint256) {
        return uint256(documentHash);
    }

    function mint(address creditor, Invoice calldata inv) external returns (uint256 tokenId) {
        if (msg.sender != issuer) revert NotIssuer();
        if (
            creditor == address(0) || inv.payer == address(0) || inv.documentHash == bytes32(0) || inv.termsHash == bytes32(0)
                || inv.amountMinor == 0 || inv.faceValue == 0 || inv.dueDate == 0 || inv.currency == bytes3(0) || inv.settled
        ) revert BadInvoice();
        tokenId = tokenIdOf(inv.documentHash);
        if (invoices[tokenId].documentHash != bytes32(0)) revert AlreadyTokenized();
        if (termsUsed[inv.termsHash]) revert TermsAlreadyUsed();
        termsUsed[inv.termsHash] = true;
        invoices[tokenId] = inv;
        _mint(creditor, tokenId);
        emit Minted(tokenId, creditor, inv.termsHash, inv.faceValue, inv.dueDate);
    }

    /// The holder offers the token to one financier for a price up to the face value. A new offer replaces the old.
    function offerFinancing(uint256 tokenId, address financier, uint256 price) external {
        address holder = _requireOwned(tokenId);
        if (msg.sender != holder) revert NotHolder();
        if (financier == address(0) || financier == holder || price == 0 || price > invoices[tokenId].faceValue) revert BadOffer();
        offers[tokenId] = Offer(financier, price);
        emit Offered(tokenId, financier, price);
    }

    /// The financier pays the agreed price to the holder and receives the token, in one transaction. `price` must be
    /// the price the financier saw, so a changed offer cannot take more than it agreed to.
    function acceptFinancing(uint256 tokenId, uint256 price) external {
        Offer memory o = offers[tokenId];
        if (o.financier == address(0)) revert NoOffer();
        if (msg.sender != o.financier) revert BadOffer();
        if (o.price != price) revert PriceChanged();
        address seller = _requireOwned(tokenId);
        delete offers[tokenId];
        _transfer(seller, o.financier, tokenId);
        token.safeTransferFrom(o.financier, seller, price);
        emit Financed(tokenId, seller, o.financier, price);
    }

    /// The debtor's paying wallet pays the face value to the current holder; the token is burned. Once only.
    function settle(uint256 tokenId) external {
        Invoice storage inv = invoices[tokenId];
        if (inv.documentHash == bytes32(0)) revert BadInvoice();
        if (inv.settled) revert AlreadySettled();
        if (msg.sender != inv.payer) revert NotPayer();
        address holder = _requireOwned(tokenId);
        inv.settled = true;
        delete offers[tokenId];
        _burn(tokenId);
        token.safeTransferFrom(msg.sender, holder, inv.faceValue);
        emit Settled(tokenId, holder, inv.faceValue);
    }

    function invoiceOf(uint256 tokenId) external view returns (Invoice memory) {
        return invoices[tokenId];
    }

    function offerOf(uint256 tokenId) external view returns (Offer memory) {
        return offers[tokenId];
    }

    /// Any transfer of the token cancels an open offer: the new holder has made none.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0)) delete offers[tokenId];
    }
}
