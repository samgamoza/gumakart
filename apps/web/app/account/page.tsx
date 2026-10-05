import type { Metadata } from "next";
import { GumaIdAccount } from "@/components/guma-id/account";

export const metadata: Metadata = {
  title: "Guma ID — mga order mo sa lahat ng shop",
  description: "Isang mobile number para sa lahat ng Guma Kart shops: mabilis na checkout, lahat ng order mo, at kontrol sa texts.",
  robots: { index: false },
};

export default function AccountPage() {
  return <GumaIdAccount />;
}
