# AgentBridge - Business Outcome Assurance Control Tower

> **Agents do the work. AgentBridge verifies the result.**  
> *Don't trust the status. Verify the outcome.*

AgentBridge is an enterprise-grade Business Outcome Assurance Layer for autonomous multi-agent workflows, designed as a prototype for the Paytm Hackathon. All merchant onboarding workflows, agent executions, and authoritative source systems in this workspace are **SIMULATED** for safe local demonstration.

---

## Core Architecture

1. **Multi-Agent Business Workflow (`src/server/workflowEngine.ts`)**
   - Coordinates four specialized simulated agents: **Sales Agent**, **KYC Agent**, **Risk Agent**, and **Operations Agent**.
   - Demonstrates 7 operational & failure scenarios:
     - `FALSE_COMPLETION`: KYC Agent reports `KYC_APPROVED` while Authoritative KYC API returns `KYC_PENDING`; Operations is blocked until verified.
     - `NORMAL`: Clean end-to-end onboarding verification.
     - `API_TIMEOUT`: Upstream HTTP timeout after committed side-effect; verifies source state rather than blindly retrying.
     - `DUPLICATE_ATTEMPT`: Idempotency guard blocks duplicate merchant activation attempts.
     - `DELAYED_CONSISTENCY`: Bounded exponential backoff rechecks until eventual consistency converges.
     - `SOURCE_UNAVAILABLE`: Authoritative API `503` transitions stage to `VERIFICATION_PENDING` rather than false failure.
     - `HUMAN_APPROVAL`: High-risk MCC pauses workflow at `NEEDS_HUMAN` until Compliance Officer approves/rejects in the Approval Queue.

2. **3-Level Deterministic Validation Engine (`src/core/validation.ts`)**
   - **Level 1 — AI Response Validation**: Zod schema, required fields, and semantic consistency checks. AI outputs are never treated as authoritative proof.
   - **Level 2 — Execution Validation**: Verifies registered tool capabilities, least-privilege permissions, request IDs, and persisted idempotency keys.
   - **Level 3 — Business Outcome Validation (`OutcomeVerifier`)**: Queries independent authoritative mock systems (`src/server/mockSystems.ts`) and blocks downstream stages on mismatch.

3. **Tamper-Evident Audit Ledger (`src/core/audit.ts`)**
   - Append-only event log with SHA-256 hash chaining (`previousHash` + canonical event payload → `eventHash`) and one-click integrity verification (`GET /api/v1/audit/verify`).

4. **Real-Time Control Tower UI (`src/App.tsx`, `src/client/`)**
   - Live SSE updates (`/api/v1/events/stream`).
   - Paytm Light & Dark themes (`#002E6E` / `#0095D9`) built on shadcn/ui (`@base-ui/react`) and Tailwind CSS v4.
   - 4 Individual Department Readiness cards (`Sales & Intake`, `KYC Verification`, `Compliance & Risk`, `Operations & Activation`), Top Issues Triage, 7-Person Team Queue, React Flow workflow DAG, Stage Inspector, Validation Centre, Human Approval Queue, Connected Systems (10-link Pi Agent & Bank API topology), A2A Analytics, Audit Logs, and Global `⌘K` Command Palette.

5. **Paytm Bot & Sarvam AI Voice + Chat Architecture (`src/server/chatAssistant.ts`, `src/server/sarvamVoice.ts`)**
   - **Floating Corner Assistant & Full ChatGPT Workspace (`/chat`)**: Non-technical ops managers can speak or type questions in **English, Hinglish, Hindi (`hi-IN`), Tamil (`ta-IN`), or Telugu (`te-IN`)**, explain any screen, jump straight to pages via clickable navigation buttons, and launch **Start Onboarding Demo** right inside the bot.
   - **Server-Side API Flow (Zero API Keys Exposed in Browser)**:
     1. **Chat Reasoning (`POST /api/v1/chat`)**: Calls `https://api.sarvam.ai/v1/chat/completions` (`model: "sarvam-m"`, `api-subscription-key: SARVAM_API_KEY`) grounded with a live JSON snapshot of journeys, department readiness, and audit integrity. Falls back to Gemini (`gemini-4-hydrogen`) or the deterministic **Paytm Grounded Engine** if no external key is set.
     2. **Microphone Speech-to-Text (`POST /api/v1/voice/stt`)**: Records live 16kHz mono PCM **`audio/wav`** directly in the browser via Web Audio (`AudioContext` + `AnalyserNode` for the real-time waveform visualizer) and posts `multipart/form-data` (`file`, `model: "saaras:v3"`, `language_code`, `mode: "transcribe" | "codemix"`) to `https://api.sarvam.ai/speech-to-text`. When `SARVAM_API_KEY` is not set, automatically uses browser **Web Speech API (`SpeechRecognition`)** in the matching Indian locale.
     3. **Speaker Text-to-Speech (`POST /api/v1/voice/tts`)**: Sends clean assistant reply text (max 500 chars) to `https://api.sarvam.ai/text-to-speech` (`model: "bulbul:v3"`, `speaker: "roopa"`, `target_language_code`, `output_audio_codec: "mp3"`) and streams MP3 audio back to the UI for **Listen / Stop** playback or **Speaker On (Auto-Speak)** mode. Falls back to browser `window.speechSynthesis` when no external key is configured.
     4. **Voice Capabilities Check (`GET /api/v1/voice/capabilities`)**: Tells the frontend whether `SARVAM_API_KEY` is active on the server without revealing any secret.

---

## Environment Setup

Copy `.env.example` and configure optional server-side AI keys (never committed or exposed to the client):

```env
GEMINI_API_KEY="your-gemini-key"
SARVAM_API_KEY="your-sarvam-subscription-key"
```

---

## Commands

```bash
# Install dependencies
npm install

# Run unit & workflow integration tests (node:test via tsx)
npm test

# Type-check TypeScript
npm run lint

# Start full-stack dev server (Express API + Vite on port 3000)
npm run dev

# Build production frontend bundle
npm run build
```

---

## Production-Readiness Boundaries

- **Simulated Sources & Agents**: Mock Merchant, KYC, Risk, and Activation APIs run locally in `.data/agentbridge-store.json` without connecting to real Paytm endpoints or customer PII.
- **Persistence & Orchestration**: Uses a file-backed JSON state store and deterministic state machine in-process rather than external PostgreSQL + Temporal cluster services so the prototype runs reliably out of the box in a single container.
