import type { Metadata } from "next";
import { PosLogin } from "@/components/pos/pos-login";

export const metadata: Metadata = { title: "Unlock register — Guma Kart" };

export default function PosLoginPage() {
  return <PosLogin />;
}
