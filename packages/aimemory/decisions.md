# AIMemory Plugin: Design Decisions Log

This document records key architectural and design decisions made during the development of the AIMemory plugin. Update this file as new decisions are made or existing ones are revised.

---

## Decisions

### 1. Message Storage Structure

-   **Decision:** Use a flat `Message[]` array to store all messages, rather than a `Map<conversationId, Message[]>`.
-   **Rationale:** Simpler code, easier to serialize, and flexible for future storage backends. Retrieval will filter by `conversationId`.
-   **Date:** [To be filled with today's date]

### 2. Abstraction Layer for Storage

-   **Decision:** Use TypeScript interfaces as the abstraction layer in front of storage implementations (e.g., in-memory, SQLite, etc.) and similar components.
-   **Rationale:** Promotes loose coupling, testability, and flexibility to swap or extend storage backends and other services in the future.
-   **Date:** [To be filled with today's date]

### 3. Buffer Timeout Handling

-   **Decision:** The message buffer manages per-conversation timers internally and accepts a callback for timeout events. When a buffer times out, the buffer calls the callback (provided by the plugin), which enqueues an extraction job and clears the buffer.
-   **Rationale:** This encapsulates timer logic within the buffer, keeps the plugin focused on orchestration, and makes the system more modular and testable.
-   **Date:** [To be filled with today's date]

---

_Add new decisions below as the project progresses._
