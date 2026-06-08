# IFS Validation Rules Catalog (Empirically Derived)

This catalog contains validation rules generated empirically by analyzing pattern compliance across **4** files in the configured IFS Core solution repository:
**Location:** `C:\Users\pulkit.gupta\.gemini\antigravity\brain\6b99b887-6a46-4bac-8da5-38c9d728e04f\scratch\mock_core`
**Generated On:** 8/6/2026

---

## Derived Rules Reference

### [ARCH-002] Customizations must use Cust/Extension layer.
* **Domain:** `architecture`
* **Severity:** `CRITICAL`
* **Applicability:** `all`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 1 files (Compliant: 1, Violations: 0)

#### Remediation Guidance:
> Move customization to Cust/Extension layer. Ensure packages end with _Cust or layer = "Cust".

* **Exceptions Allowed:** `FNDBAS, General_SYS, Client_SYS`

---
### [ARCH-005] Cross-component protected method calls are prohibited.
* **Domain:** `architecture`
* **Severity:** `HIGH`
* **Applicability:** `Apps10`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 0 files (Compliant: 0, Violations: 0)

#### Remediation Guidance:
> Do not call protected methods (ending in single underscore) belonging to other business components. Use public API methods instead.

* **Exceptions Allowed:** `FNDBAS`

---
### [PERF-004] Use bulk operations (BULK COLLECT/FORALL) for row-by-row loops with DML.
* **Domain:** `performance`
* **Severity:** `HIGH`
* **Applicability:** `all`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 0 files (Compliant: 0, Violations: 0)

#### Remediation Guidance:
> Refactor row-by-row cursor loops executing DML to use FORALL and BULK COLLECT.



---
### [SEC-003] Do not use 'ifsapp.' prefix in database calls.
* **Domain:** `security`
* **Severity:** `HIGH`
* **Applicability:** `all`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 3 files (Compliant: 3, Violations: 0)

#### Remediation Guidance:
> Remove hardcoded schema references. Rely on synonym calls.



---
### [CLOUD-001] Projection files must declare component and layer.
* **Domain:** `cloud_marble`
* **Severity:** `CRITICAL`
* **Applicability:** `Cloud`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 0 files (Compliant: 0, Violations: 0)

#### Remediation Guidance:
> Declare the component and layer header in the projection definition (e.g. component = "ACCRUL"; layer = "Cust";).



---
### [CLOUD-002] Prefer override over overtake for client extensions.
* **Domain:** `cloud_marble`
* **Severity:** `HIGH`
* **Applicability:** `Cloud`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 0 files (Compliant: 0, Violations: 0)

#### Remediation Guidance:
> Use override to extend client elements. Avoid overtake unless structurally mandatory.



---
### [NAME-001] Cursors should be prefixed with 'c_'.
* **Domain:** `naming`
* **Severity:** `Minor`
* **Applicability:** `all`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 0 files (Compliant: 0, Violations: 0)

#### Remediation Guidance:
> Rename cursors to start with c_ prefix (e.g. c_get_voucher).



---
### [DATA-001] NULL comparisons must use IS NULL or IS NOT NULL.
* **Domain:** `data_integrity`
* **Severity:** `HIGH`
* **Applicability:** `all`
* **Empirical Confidence:** `1 (STABLE ✅)`
* **Scanned Sample Size:** 100 files (Compliant: 100, Violations: 0)

#### Remediation Guidance:
> Change '= NULL' to 'IS NULL' and '!= NULL' to 'IS NOT NULL'.



---
### [I18N-001] String literals must not contain non-ASCII characters.
* **Domain:** `i18n`
* **Severity:** `Minor`
* **Applicability:** `all`
* **Empirical Confidence:** `0.95 (STABLE ✅)`
* **Scanned Sample Size:** 1000 files (Compliant: 1000, Violations: 0)

#### Remediation Guidance:
> Extract hardcoded non-ASCII string literals into localized translation keys.



---
