/**
 * The shared IMetadataStore contract, run against SQLite.
 *
 * The contract suite has existed since the storage-switch plan but nothing
 * invoked it, so it was dead code and the adapters had no behavioural
 * coverage of their own (2026-09-08g). MongoDB needs a server and is not run
 * here; `npm run typecheck:metadata` compiles that adapter so its types are
 * checked, and the cases below are written against the interface so the
 * Mongo suite can call the same function when a server is available.
 */
import { SqliteMetadataStore } from "./sqlite-adapter.js";
import { runMetadataStoreContract } from "./metadata-store.contract.js";
import type { IMetadataStore } from "./interface.js";

runMetadataStoreContract(
  "SQLite (:memory:)",
  async () => new SqliteMetadataStore(":memory:") as IMetadataStore,
  async (store) => { await store.close(); },
);
