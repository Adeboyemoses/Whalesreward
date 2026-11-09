import type { ReactNode } from "react";
import { Registration } from "./registration";
import "./registration.css";
export default function RegistrationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <Registration />
      {children}
    </>
  );
}
