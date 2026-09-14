import type { Pinia } from "pinia";
import { useConnectionStore } from "@/stores/connectionStore";

export function installMonacoMetadataFixture(pinia: Pinia) {
  const store = useConnectionStore(pinia);
  const tables = [{ name: "users", database: "fixture", type: "table" as const }];
  const columns = ["id", "name", "email", ...Array.from({ length: 200 }, (_, index) => `field_${index}`)].map((name) => ({ name, table: "users", dataType: "varchar" }));
  store.lookupLocalCompletionTables = () => tables;
  store.listCompletionTables = async () => tables;
  store.lookupLocalCompletionColumns = () => columns;
  store.lookupLocalCompletionColumnsByPrefix = () => columns;
  store.listCompletionColumns = async () => columns;
  store.listCompletionColumnsByPrefix = async () => columns;
  store.lookupLocalCompletionDatabases = () => ["fixture"];
  store.listCompletionDatabases = async () => ["fixture"];
  store.lookupLocalCompletionSchemas = () => [];
  store.listCompletionSchemas = async () => [];
  store.lookupLocalCompletionObjects = () => [];
  store.listCompletionObjects = async () => [];
  store.lookupLocalCompletionForeignKeys = () => [];
  store.listCompletionForeignKeys = async () => [];
}
