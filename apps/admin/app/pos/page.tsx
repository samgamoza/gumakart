import type { Metadata } from "next";
import { PosRegister } from "@/components/pos/pos-register";

export const metadata: Metadata = { title: "POS — Guma Kart" };

export default function PosPage() {
  return <PosRegister />;
}
