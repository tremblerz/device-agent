# On-Device Counsel — dual-device demo

A **conflict-resolution** demo: two people, two iPhones. Each phone runs its own
impartial AI **counselor** entirely on-device (via
[llama.rn](https://github.com/mybigday/llama.rn)), and the two phones talk
**directly over Bluetooth / peer-to-peer Wi-Fi** (Apple MultipeerConnectivity,
via [`expo-nearby-connections`](https://github.com/puguhsudarma/expo-nearby-connections))
— no cloud, no router, no uploads. The counselors negotiate a fair resolution,
pausing to ask their own user for more when needed. Built on the
[`react-native-device-agent`](../packages/react-native-device-agent) harness.

> **iOS only.** MultipeerConnectivity is Apple-only, and a real run needs **two
> physical iPhones** — the Simulator can't do the Bluetooth/peer-Wi-Fi transport.

This is an Expo app that needs a **custom dev build** (native modules; won't run
in Expo Go).

## The flow

1. Each phone: enter your name, download/load the model (~1.1 GB, once per phone).
2. One phone taps **Host** (sets the agenda → Party A), the other taps **Join**
   and picks the host (→ Party B).
3. Each user privately tells *their own* counselor their side. This text never
   leaves the phone — only the counselor's messages cross the channel.
4. The counselors negotiate over the channel; either may pause to ask its user
   for more info, then propose a resolution.
5. When a proposal is agreed by both counselors, each user accepts or pushes
   back. Both accept → resolved.

Key files in [src/mediation/](src/mediation/): `peerSession.ts` (per-device
state machine), `protocol.ts` + `channel.ts` (the transport seam),
`mediationAgent.ts` (one counselor; uses the harness's tool-calling for
structured turns), `controlTools.ts` (the per-turn actions).

## Run it (two iPhones)

From the monorepo root, install once: `npm install`. Native projects are already
generated (`expo prebuild`). Then, with a device connected:

```sh
npm run ios            # = npx expo run:ios   — pick your device when prompted
```

Repeat for the second iPhone (or distribute the signed build to both). On first
launch each phone asks for **Local Network** and **Bluetooth** permission —
allow both, or discovery won't work. One phone Hosts, the other Joins.

## Notes

- **Model**: Qwen2.5-1.5B-Instruct (Q4_K_M) — change in [src/config.ts](src/config.ts).
  Multi-turn negotiation is demanding; bumping to a 3B model noticeably improves it.
- Regenerate native projects with `npx expo prebuild --clean` (then `npx pod-install`).
  Permissions, the `_device-counsel` Bonjour service, iOS 16.4 target, and the
  llama.rn ProGuard rule all come from [app.json](app.json), so they survive prebuilds.
- **Node**: RN 0.85/Expo 56 want Node 20.19+/22.13+/24.3+. Node 23 works here but
  is unsupported upstream.
