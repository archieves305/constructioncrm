import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Video } from "react-native-compressor";
import { VIDEO_BITRATE, VIDEO_LONG_SIDE, videoName, videoTooBig } from "./rules";

/**
 * Shrink a recorded or picked video and keep it in the app's folder until it
 * is sent: 720p, about 2.5 Mbit/s, H.264 MP4, location and other metadata
 * left out (as for photos). Reports progress 0–1.
 */
export async function prepareVideo(uri: string, onProgress?: (p: number) => void): Promise<{ path: string; bytes: number }> {
  const out = await Video.compress(
    uri,
    { compressionMethod: "manual", maxSize: VIDEO_LONG_SIDE, bitrate: VIDEO_BITRATE, preserveMetadata: false, progressDivider: 5 },
    onProgress,
  );
  const shrunk = new File(out.startsWith("file:") ? out : `file://${out}`);
  const problem = videoTooBig(shrunk.size);
  if (problem) {
    try {
      shrunk.delete();
    } catch {
      // gone
    }
    throw new Error(problem);
  }
  const dir = new Directory(Paths.document, "outbox-photos", Crypto.randomUUID().slice(0, 8));
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, videoName());
  shrunk.move(dest);
  return { path: dest.uri, bytes: dest.size };
}
