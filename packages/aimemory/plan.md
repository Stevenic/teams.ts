# AIMemory Plugin Development Plan

This document outlines the phased approach for building the AIMemory plugin for the Teams library, starting with short-term memory (message storage/retrieval) and expanding to LLM-powered features.

---

## Phase 1: Short-Term Memory (Message Buffer/History)

**Goal:**
Implement the ability to ingest, store, and retrieve recent messages per conversation (short-term memory). This forms the foundation for all future memory/LLM features.

### Tasks

-   **Define Types/Interfaces**
    -   Message (id, text, sender, timestamp, conversationId, etc.)
    -   Conversation (id, participants, etc.)
    -   Storage interface for messages (in-memory for now)
-   **Implement In-Memory Message Storage**
    -   Store messages per conversation (e.g., `Message[]`)
    -   Methods: `addMessage`, `getRecentMessages(conversationId, limit)`
-   **Plugin API**
    -   Expose methods to add a message and retrieve recent messages
    -   Integrate with Teams plugin lifecycle (`onInit`, etc.)
-   **Basic Tests**
    -   Add and retrieve messages, ensure correct ordering and limits

---

## Phase 2: Buffering and Extraction Triggers (with Out-of-Process Extraction)

**Goal:**
Buffer messages per conversation and trigger extraction by enqueuing a job for a separate worker process when the buffer is ready (by size or timeout).

### Tasks

-   **Message Buffer**
    -   Buffer messages per conversation
    -   Configurable buffer size and timeout
-   **Trigger Logic**
    -   When buffer is full or timeout elapses, enqueue a job for extraction (do not process in-process)
    -   For now, just clear the buffer and move messages to history
-   **Queue Mechanism**
    -   Use a persistent queue (e.g., SQLite table, Redis, or file) to coordinate with the worker process
-   **Events**
    -   Use plugin event system to emit buffer events if needed

---

## Phase 3: Pluggable Storage Backends

**Goal:**
Abstract message storage to allow for different backends (in-memory, SQLite, etc.)

### Tasks

-   **Storage Interface**
    -   Define interface for message storage
    -   Implement in-memory and stub for SQLite
-   **Configurable Backend**
    -   Allow plugin to be configured with desired backend

---

## Phase 4: LLM Integration (Extraction, Search, Q&A)

**Goal:**
Integrate LLM for semantic memory extraction, search, and Q&A, performed by a separate worker process.

### Tasks

-   **LLM Service Abstraction**
    -   Interface for LLM calls (extract, embed, answer)
-   **Memory Extraction**
    -   Worker process listens for jobs in the queue and performs extraction
    -   Store extracted memories
-   **Semantic Search**
    -   Embed memories/messages, allow search by embedding similarity
-   **Q&A**
    -   Allow asking questions over stored memories/messages

---

## Phase 5: Middleware Integration & API Polish

**Goal:**
Integrate as middleware in Teams bots, polish API, add docs and examples.

### Tasks

-   **Middleware**
    -   Intercept messages, add to memory automatically
-   **API Polish**
    -   Finalize public API, add docs, usage examples

---

## Inter-Process Coordination: Queue/Worker Architecture

-   The main process buffers and stores messages, and enqueues jobs for extraction when buffers are ready.
-   A separate worker process listens for jobs in the queue, performs LLM extraction, and stores results.
-   The queue can be implemented using SQLite, Redis, or another persistent mechanism.
-   This architecture allows for non-blocking ingestion, scalability, and resilience.

---

## Next Steps

-   **Start with Phase 2:**
    -   Implement message buffering and trigger logic.
    -   Scaffold the queue/job mechanism for extraction.

---

_This plan is a living document and can be adjusted as requirements evolve._
