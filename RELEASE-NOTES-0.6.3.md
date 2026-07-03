# Singra Vault 0.6.3 — Centralized Legal & Design DNA Update

**Release date:** 2026-07-03

This release migrates the legal structure of Singra Vault to a centralized, external host and adopts the clean, premium styling from the Maunting Studios Design DNA.

---

## Changed

- **Centralized Imprint:** Removed the local internal `/impressum` route and page. All legal notice links, footers, and settings now point directly to `https://www.mauntingstudios.de/imprint`.
- **Design DNA Legal Document Styling:** Replaced the custom Accordion layout on the Privacy Policy page with the new `<LegalDocumentViewer />` component, ensuring uniform readability and styling consistent with our brand guidelines.
- **Language Switcher Upgrade:** Swapped the legacy flag-based dropdown selector in the footer with the new ice-accented `<LanguageSwitcher />` component from the Maunting Design DNA, providing a sleeker and more accessible way to switch between German and English.
- **Dependency cleanup:** Removed the unused `DropdownMenu` primitives from the landing footer for improved chunk sizing.
