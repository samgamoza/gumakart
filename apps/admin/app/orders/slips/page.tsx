import { Suspense } from "react";
import { PackingSlips } from "@/components/packing-slips";

export default function PackingSlipsPage() {
  return (
    <Suspense>
      <PackingSlips />
    </Suspense>
  );
}
