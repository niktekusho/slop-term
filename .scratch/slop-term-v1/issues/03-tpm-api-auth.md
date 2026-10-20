# How Team Password Manager API auth works with SSO

Type: research
Status: resolved
Blocked by:

## Question

How can a desktop app authenticate to the Team Password Manager REST API when users log in to the web UI through company SSO?

Cover: which API auth methods TPM offers (HMAC keys, basic auth, others), whether an admin must enable API access, whether SSO-only users can get API credentials, which endpoints read and write a password entry, and the version differences that matter. The user's instance is https://tpm.gpi.it/index.php. It is not reachable from the agent, so use the public TPM docs.

## Answer

TPM's API has two auth methods, HTTP Basic and HMAC. It has no OAuth or OIDC. SAML (SSO) users have no TPM password, so they can only use HMAC keys from My Account > API Keys, and only on TPM 10.138.240 or later.
An admin must turn on API access (off by default). The admin must also not restrict the API to "API only" users or to "HTTP Basic only". LDAP users can use either method.
Read a secret with `GET index.php/api/v6/passwords/<ID>.json`. Write one with `PUT` on the same path. Writes need "Edit data" permission, which the response field `user_permission` reports.
Use API v6 on TPM 13.166.291 or later (v4 is gone there) and v5 on older versions. The findings include a checklist for the user and a message for the admin.

Findings: [research/tpm-api-auth.md](../research/tpm-api-auth.md)
