# Get TPM API access

Type: task
Status: resolved
Blocked by: 03

## Question

Can the user get working API credentials for https://tpm.gpi.it/index.php? Using the method found in "How Team Password Manager API auth works with SSO", check the user's TPM profile or ask the TPM admin, then make one test API call that reads one password entry. Record the result: works, works read-only, or not possible (and why).

Asset: [tpm-test.ps1](../tpm-test.ps1), a signed test call that prints status codes and permissions, never the secret.

## Answer

Works, with reads and writes. Tested on 2026-10-19 with the user's own HMAC keys and [tpm-test.ps1](../tpm-test.ps1).

- The instance runs TPM 14.184.308 with API v6. API access is on, and HMAC keys have no expiry, so v1 needs no key-renewal flow for this instance.
- `users/me.json` reports `is_saml=true`, `is_ldap=true` and `is_api_only=false`. HMAC works whatever the login type, so the app uses HMAC only.
- `passwords/65120.json` returned 200 with the password, and `user_permission` was 30 (Manage). In v6, `user_permission` is an object `{"id": 30, "label": "Manage"}`, not a bare number. A provider checks `id >= 20` to allow writes.
- TPM returns 415 "Missing Content-Type header" on a GET with no `Content-Type` header. Clients that drop the header on bodyless requests (PowerShell's `Invoke-WebRequest`) have to send an empty JSON body.
