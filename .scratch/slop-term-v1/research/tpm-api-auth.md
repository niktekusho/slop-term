# How Team Password Manager API auth works with SSO

Answers issue 03. Sources are the vendor docs at teampasswordmanager.com, read on 2026-10-19. The docs describe TPM 15.200.312 and API v6. Nothing here was tested against https://tpm.gpi.it.

## Short answer

A desktop app can call the TPM API as the user with HMAC keys, if three things hold:

1. An admin has enabled API access (it is off by default).
2. The admin has not limited the API to "API only" users, and has not set the auth method to "HTTP Basic only".
3. The instance runs TPM 10.138.240 or later. Before that release, SAML users could not use the API at all.

The user copies a public and a private key from My Account > API Keys in the web UI. The app signs each request with the private key. No SSO flow, OAuth or browser redirect is involved. TPM has no OAuth or OIDC API login.

"SSO" can mean two different things in TPM, and the answer differs:

- **SAML users** (the login page sends you to the company identity provider). They have no TPM password, so HTTP Basic is impossible. HMAC is the only method.
- **LDAP users** (you type your company/AD password into the TPM login form). Both HTTP Basic (with the LDAP password) and HMAC work.

## Auth methods

TPM offers two API auth methods, HTTP Basic and HMAC ([API overview](https://teampasswordmanager.com/docs/api/), [API authentication](https://teampasswordmanager.com/docs/api-authentication/)). Access is per user: "Access to the API is done at the user level", and the API grants the same permissions the user has in the web UI.

### HTTP Basic

- The client sends the TPM username and password on each request (`curl -u username:password`).
- For LDAP users, "Team Password Manager will transparently authenticate the API request using LDAP."
- The API skips two-factor auth: "API authentication will NOT use Two-factor authentication if the user has 2FA enabled."
- Not available to SAML users, because "SAML users are like regular users but don't have a password" ([SAML authentication](https://teampasswordmanager.com/docs/saml-authentication/)).

### HMAC

From [API authentication](https://teampasswordmanager.com/docs/api-authentication/):

- Each user has a public key and a private key on the "API Keys" tab of My Account. "If you don't see this tab it means that API access is disabled."
- The private key never goes over the wire.
- The string to sign is the concatenation, with no separators, of:
  1. the URL path after `index.php/`, with no leading or trailing slash, for example `api/v6/passwords/123.json`;
  2. a Unix timestamp in seconds (PHP `time()`);
  3. the JSON request body, if there is one.
- The signature is `hash_hmac('sha256', $unhashed, $private_key)`, as lowercase hex.
- Headers on every request:
  - `X-Public-Key: <public key>`
  - `X-Request-Hash: <signature>`
  - `X-Request-Timestamp: <timestamp>`
  - `Content-Type: application/json; charset=utf-8` (required on every request, otherwise `415 Unsupported Media Type`)
- The docs do not state the allowed clock skew. The SAML docs ask admins to run NTP on the server, so the client clock should be synced too.
- Admins can make keys expire after 1 to 999 days (0 means never), since 13.166.291. Expired keys return `401` with "HMAC API key has expired". The user renews them with the "Renew API Keys" button on the same tab, and the app must then get the new pair.

For slop-term this means the HMAC key pair is itself a secret. The app has to store it somewhere (the OS keychain is the obvious place) and offer a way to replace it after renewal.

## Admin settings that decide whether it works

All are global, under Settings > API ([API overview](https://teampasswordmanager.com/docs/api/), [API authentication](https://teampasswordmanager.com/docs/api-authentication/)):

| Setting | Default | Effect on an SSO user |
|---|---|---|
| "Enable API access" | Off | Off: every call returns `403` "API access is disabled", and the API Keys tab is hidden. |
| "Edit API Security" (since 7.103.208) | All users | "Only API only users": a normal SAML or LDAP user cannot use the API. SAML users "cannot be 'API only' users". |
| "Edit API Authentication Method" (since 13.166.291) | HTTP Basic and HMAC | "HTTP Basic only" locks out SAML users. "HMAC only" is fine. |
| "Edit HMAC API Keys Expiration" (since 13.166.291) | No expiry | Keys stop working after N days until renewed. |

There is no per-user API switch. A deactivated user cannot use the API, and blocked IPs are refused (7.79.190, [changelog](https://teampasswordmanager.com/docs/changelog/)).

If the admin insists on "API only" users, the fallback is a separate API-only account (local or LDAP, never SAML) shared to the projects the user needs. That account can't log in to the web UI ([users and groups](https://teampasswordmanager.com/docs/users-groups/)).

## Endpoints for reading and writing a password

Base URL: `https://tpm.gpi.it/index.php/api/v6/`. From [API passwords](https://teampasswordmanager.com/docs/api-passwords/):

| Need | Request | Success |
|---|---|---|
| Find entries | `GET passwords/search/<urlencoded query>.json` | 200, paginated |
| List entries | `GET passwords.json` | 200, paginated (`page`, and `X-Page-Size` 5 to 1000 in v6) |
| Read one entry with its secret | `GET passwords/<ID>.json` | 200 |
| Change the secret | `PUT passwords/<ID>.json` with body `{"password": "..."}` | 204, no body |
| Create an entry | `POST passwords.json` | 201, body `{"id": ...}` |

- The list and search results do not carry the secret. Only "show" (`GET passwords/<ID>.json`) returns `password`, along with `username`, `access_info`, `notes` and `custom_field1` to `custom_field10`. So a Credential reference should store the numeric entry ID.
- Permission levels: 0 none, 10 read, 20 edit data, 30 manage. The response field `user_permission` gives the caller's level. Writes need "Edit data" or higher. A provider can read `user_permission` to decide whether it refuses writes.
- PUT can update `name, tags, access_info, username, email, password, expiry_date, notes, custom_data1..10`.
- Linked passwords are read-only: PUT returns `403`.
- Locked passwords return only metadata unless the request sends `X-Unlock-Reason: <text>`, which notifies the managers. Locking type 2 ("requires permission to be unlocked") "cannot be used with the API" and returns `409`.
- Personal entries live under a separate resource, My Passwords ([docs](https://teampasswordmanager.com/docs/api-my-passwords/)).
- `GET users/me.json` returns the caller's `is_saml`, `is_ldap`, `is_api_only`, `role` and `is_2fa_enabled` ([API users](https://teampasswordmanager.com/docs/api-users/)). `GET version.json` returns the TPM version and the API version in use ([API version](https://teampasswordmanager.com/docs/api-version/)). Either works as a harmless first test call.

## Versions that matter

From the [TPM changelog](https://teampasswordmanager.com/docs/changelog/) and [API changelog](https://teampasswordmanager.com/docs/api-changelog/):

| TPM version | Date | Change |
|---|---|---|
| 4.32.68 | 2014-07-24 | API v1. |
| 6.63.136 | 2015-12-17 | "API only" users. |
| 7.103.208 | 2019-12-27 | Admin can limit the API to "API only" users. |
| 9.125.225 | 2021 | SAML login added. SAML users have no API access yet. |
| 10.135.236 | 2021-11-12 | API v5. |
| 10.138.240 | 2022-02-15 | SAML users can use the API with HMAC. |
| 13.166.291 | 2024-12-19 | API v6. API v4 removed. Auth method setting and HMAC key expiry added. |
| 14.184.308 | 2026-03-10 | Fix: wrong LDAP credentials returned 500 instead of 401. |
| 15.200.312 | current docs | Latest version the docs show. |

- Target API v6 if the instance is 13.166.291 or later, otherwise v5. The v5 and v6 password show and update calls look the same. The docs don't say whether v5 still works on 13.x and later.
- The HMAC scheme has not changed across these versions. Only the path in the signed string carries the version (`api/v5/...` or `api/v6/...`).
- Admins see the API version at Settings > API, and `GET version.json` returns the TPM version.

## Checklist for the user (feeds issue 06)

Do these in the web UI at https://tpm.gpi.it/index.php, logged in as usual.

1. **Find your user type.** If the login page sent you to the company identity provider (Microsoft, Okta and similar) you are a SAML user. If you typed your company password into the TPM form you are an LDAP user. If you are unsure, the user list (admins) or the `users/me.json` call in step 6 shows `is_saml` / `is_ldap`.
2. **Find the TPM version.** The docs only name Settings > API (admins) and the `version.json` call. The web UI may also show it on an About or footer line (not confirmed in the docs). If you can't find it, ask the admin.
   - Below 10.138.240 and SAML: the API is not possible for you. Ask the admin to upgrade.
   - 13.166.291 or later: use API v6. Between 10.135.236 and 13.166.291: use v5.
3. **Open My Account and look for the "API Keys" tab.**
   - Present: API access is enabled. Copy the public key and the private key. Note any expiry date shown.
   - Missing: API access is disabled. Go to the admin questions below.
4. If you are an LDAP user and want to avoid key handling, HTTP Basic with your normal login also works, unless the admin chose "HMAC only".
5. **Pick a test entry** you can open in the web UI. Its ID is the number at the end of the URL when you view it (not confirmed in the docs). The `id` field in `GET api/v6/passwords/search/<name>.json` also gives it.
6. **Make the test call** (issue 06). First `GET api/v6/users/me.json`, then `GET api/v6/passwords/<ID>.json`, signed as described above. Check `is_saml`, `is_api_only` and `user_permission` in the responses.
7. **Record the result:**
   - `200` with `password` filled in and `user_permission` 20 or 30: works with reads and writes.
   - `200` with `user_permission` 10: works read-only.
   - `403` "API access is disabled": the API is off.
   - `401` or `403` on a correct signature: the method is limited to Basic, the API is limited to "API only" users, or the keys expired. Ask the admin.
   - `415`: the `Content-Type` header is missing (a client bug, not a policy).

### What to ask the TPM admin

Send this if the API Keys tab is missing or step 7 fails:

> I want to use the TPM API from a desktop app with my own account. I log in through SSO (SAML), so I can only use HMAC keys. Can you check under Settings > API that:
> 1. API access is enabled;
> 2. "API Security" allows all users, not only "API only" users (SAML users cannot be API only);
> 3. "API Authentication Method" is "HTTP Basic and HMAC" or "HMAC only", not "HTTP Basic only";
> 4. what the HMAC key expiration is, so I know when to renew my keys;
> 5. which TPM version we run (it must be 10.138.240 or later for SAML users), and that my IP is not blocked.

If the admin refuses to open the API to normal users, ask for an API-only account (local or LDAP) shared read or edit on the needed projects.

## Open points

- The docs don't state the timestamp tolerance for HMAC. Keep the client clock synced and treat a hash mismatch near a clock change as a likely skew.
- The docs don't say whether API v5 still answers on TPM 13.166.291 and later.
- The API ignores TPM's own 2FA. Whether the company IdP's MFA covers API use is the admin's policy, not a TPM setting.
