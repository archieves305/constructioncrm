import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import type { DocumentPickerAsset } from "expo-document-picker";
import { safeName } from "./rules";

/**
 * A document picked from the phone (Files app, iCloud Drive, a mail
 * attachment saved to Files), checked against the CRM's own rules and copied
 * into the app's folder under its own name, so it survives until it is sent.
 */
export function prepareDocument(asset: DocumentPickerAsset): { path: string } {
  const dir = new Directory(Paths.document, "outbox-photos", Crypto.randomUUID().slice(0, 8));
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, safeName(asset.name));
  new File(asset.uri).copy(dest);
  return { path: dest.uri };
}
