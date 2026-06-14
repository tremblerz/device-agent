# device-agent

An on-device LLM **agent harness** for React Native, built on
[llama.rn](https://github.com/mybigday/llama.rn). Register plain JavaScript
functions as tools and let a locally-running LLM call them — no cloud, no API
keys, fully offline.

This is a monorepo:

| Path | What it is |
| --- | --- |
| [`packages/react-native-device-agent`](packages/react-native-device-agent) | The publishable package: the agentic loop, tool registry, llama.rn wrapper, and batteries-included device/filesystem/network tools. |
| [`example`](example) | A demo Expo app — a chat assistant whose on-device model can call tools mid-conversation. |

## Goals

1. **A great open-source package** so any RN app can add an on-device agent in a few lines.
2. **A demo app** that validates the harness and shows it off.

We build the demo first, then harden the extracted package.

## Status

🚧 Early scaffolding. See the package and example READMEs for setup.
