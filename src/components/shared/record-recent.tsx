"use client";

import { useEffect } from "react";
import { recordRecentlyViewed, type RecentItem } from "./use-recently-viewed";

/** Renders nothing; notes that this record was opened so ⌘K can offer it back. */
export function RecordRecent({ item }: { item: RecentItem }) {
  const { type, id, primary, secondary, code, href } = item;
  useEffect(() => {
    recordRecentlyViewed({ type, id, primary, secondary, code, href });
  }, [type, id, primary, secondary, code, href]);
  return null;
}
