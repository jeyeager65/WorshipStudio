# Canva Setup

Worship Studio uses one Canva developer integration per church library. Each computer then authorizes the Canva account it will use through that shared integration.

## What is shared

The Canva client ID and client secret identify the integration itself. Worship Studio stores them in the church's `library-settings.json`, so they sync with the private library to the church's other computers.

This is intended for a trusted church library, such as a Dropbox folder restricted to the church's Worship Studio users. Another church using Worship Studio should create and manage its own Canva integration rather than reuse yours.

## What stays on each computer

Canva access and refresh tokens identify an authorized Canva account. They remain in the installation's local `canva-auth.json` and do not sync. Connecting or disconnecting Canva on one computer does not connect or disconnect another computer.

Portable Worship Studio keeps these local tokens with its portable application data, so the authorization travels with that portable installation.

These files are intentionally plaintext under the current trusted-church-computer model. An installed copy relies on the operating system's per-user application-data protections. A portable drive may not support equivalent permissions, so possession of the drive should be treated as access to its Canva authorization and Bible API keys. Disconnect Canva before lending or disposing of it.

## Configure the integration

1. Create an integration in a church-controlled Canva Developer account.
2. In Worship Studio, open **Settings > Canva**.
3. Copy the exact callback URL shown there into the integration's allowed redirect URLs. The complete URL, including the port and `/canva/callback`, must match.
4. Enable `design:meta:read`, `design:content:read`, and `design:content:write`.
5. Enter the client ID and client secret in Worship Studio and save.
6. Select **Connect This Computer** and authorize the desired Canva account in the browser.
7. Repeat only the last step on each additional church computer.

Installed copies default to callback port `47823`. Portable copies default to `47824`, allowing an installed and portable copy to coexist on one computer. If the port conflicts with another application, choose a different fixed port in Settings, register the resulting URL in Canva, save, and reload Worship Studio.

The Canva callback listener accepts connections only from the local computer. It is separate from the Remote Control server and is not exposed to the church network.

## Changing or revoking access

- **Disconnect This Computer** removes only that installation's local Canva authorization. It leaves the church integration available to other computers.
- To change the Canva account used on one computer, disconnect it and connect again with the desired account.
- If the client secret is exposed, rotate it in Canva, update it once in the church settings, let the library sync, and reconnect each computer if Canva invalidates existing authorization.
- If the integration itself is replaced, update both shared fields and register the callback URLs used by the church's installed and portable copies.
