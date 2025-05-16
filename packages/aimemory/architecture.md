# Teams Memory Module: Architecture Deep Dive

## Overview

The `teams_memory` package is a modular, extensible memory system for conversational AI agents (especially Microsoft Teams bots). It provides:

-   **Automatic and on-demand extraction of semantic memories** from chat history.
-   **Short-term (working) memory** retrieval for LLM context.
-   **Topic-based and query-based search** over extracted memories.
-   **Pluggable storage backends** (in-memory, SQLite, Azure AI Search).
-   **Integration as middleware** in Teams bots, augmenting the bot context with memory capabilities.

---

## High-Level Architecture

```
Teams Bot (Application)
   |
   |-- MemoryMiddleware (intercepts messages, augments context)
         |
         |-- MemoryModule (main API)
               |
               |-- MessageQueue (buffers, schedules, triggers extraction)
               |      |
               |      |-- MessageBuffer (per-conversation, threshold/timer)
               |      |-- ScheduledEventsService (timeouts)
               |
               |-- MemoryCore (LLM-powered extraction, search, storage)
                      |
                      |-- LLMService (calls LLM for extraction, embeddings, Q&A)
                      |-- Storage (Memory, Message, Buffer, Events)
```

---

## Key Components

### 1. Middleware Integration

-   **`MemoryMiddleware`**: Plugs into the Teams bot pipeline.
    -   Intercepts incoming/outgoing messages.
    -   Adds them to the memory system.
    -   Augments the bot context with a `ScopedMemoryModule` for per-conversation memory access.

### 2. MemoryModule (Main API)

-   **`MemoryModule`**: The main entry point.

    -   Handles configuration, LLM, and storage setup.
    -   Exposes methods for:
        -   Adding messages.
        -   Triggering memory extraction (automatic/on-demand).
        -   Searching/asking over memories.
        -   Retrieving chat history.
        -   Getting memories with attributions (for citations).

-   **`ScopedMemoryModule`**: A per-conversation/user view, used in bot context.

### 3. Message Buffering and Scheduling

-   **`MessageQueue`**: Orchestrates message buffering and extraction.

    -   Uses a `MessageBuffer` to collect messages per conversation.
    -   Triggers extraction when:
        -   Buffer size threshold is reached.
        -   Timeout elapses since first message.
    -   Handles initialization and shutdown.

-   **`MessageBuffer`**: Stores messages in buffer storage (in-memory/SQLite).
    -   Manages per-conversation buffers.
    -   Schedules timeouts via `ScheduledEventsService`.

### 4. Memory Core (Extraction, Search, Storage)

-   **`MemoryCore`**: The heart of the system.

    -   Handles:
        -   LLM-powered extraction of semantic facts from messages.
        -   Storing/retrieving memories and messages.
        -   Embedding-based search.
        -   Q&A over memories using LLM.
        -   Topic validation and metadata extraction.

-   **`LLMService`**: Wraps LiteLLM for:

    -   Chat completions (for extraction, Q&A).
    -   Embedding generation (for semantic search).

-   **Storage Abstractions**:
    -   **Memory Storage**: Stores extracted memories (semantic facts).
    -   **Message Storage**: Stores raw messages.
    -   **Buffer Storage**: Stores buffered (unprocessed) messages.
    -   **Scheduled Events Storage**: For timeouts.
    -   Pluggable backends: In-memory, SQLite, Azure AI Search.

### 5. Types and Interfaces

-   **Types**: `Message`, `Memory`, `Topic`, etc. (Pydantic models).
-   **Interfaces**: Abstract base classes for storage, core, modules, etc.

---

## Data Flow

1. **Message Ingestion**:

    - Middleware intercepts a message (incoming or outgoing).
    - Adds it to the memory module via `add_message`.

2. **Buffering**:

    - Message is stored in the buffer for its conversation.
    - If buffer size or timeout threshold is reached, triggers extraction.

3. **Memory Extraction**:

    - `MemoryCore` uses the LLM to extract semantic facts from buffered messages.
    - Facts are stored as `Memory` objects, with attributions to original messages.

4. **Memory Retrieval**:

    - Short-term memory: Retrieve recent messages for LLM context.
    - Semantic memory: Search or ask questions over extracted facts (embedding search + LLM Q&A).

5. **Citations**:
    - When returning a memory, can also return the original messages (with deep links) for attribution.

---

## Configuration

-   **`MemoryModuleConfig`**: Central config object.
    -   LLM settings.
    -   Storage backend selection (per-type or global).
    -   Buffer size and timeout.
    -   Topics for extraction.
    -   Logging.

---

## Extensibility

-   **Storage**: Add new backends by implementing the storage interfaces.
-   **LLM**: Any LiteLLM-supported provider/model.
-   **Topics**: Customizable for different domains.
-   **Middleware**: Can be adapted for other frameworks.

---

## Example Usage

-   **Add to bot**: Use `MemoryMiddleware` with your bot adapter.
-   **Access in handler**: `context.get("memory_module")` gives you a `ScopedMemoryModule`.
-   **Extract memories**: Automatic (via buffer) or manual (`process_messages`).
-   **Query**: `search_memories`, `ask`, `retrieve_chat_history`.

---

## Key Design Patterns

-   **Middleware**: For transparent integration.
-   **Buffering and Debouncing**: To avoid extracting on every message.
-   **LLM-in-the-loop**: For both extraction and semantic search.
-   **Attribution**: Every memory is traceable to original messages.
-   **Pluggable Storage**: For flexibility and scalability.

---

## Questions for Porting to TypeScript

1. **Do you want a 1:1 mapping of all Python classes to TypeScript, or a more idiomatic TypeScript/Node.js design?**
2. **Will you use a similar LLM/embedding provider (e.g., OpenAI, Azure OpenAI) in the TypeScript version?**
3. **What storage backends do you want to support first (in-memory, SQLite, cloud)?**
4. **Will you use a similar middleware pattern for integration with your bot framework?**
5. **Do you want to keep the topic-based extraction, or make it more generic?**

---

Let us know if you need a more detailed breakdown of any submodule, or a code-level mapping for your TypeScript implementation!
