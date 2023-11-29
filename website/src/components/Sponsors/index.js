import styles from "@site/src/components/Sponsors/styles.module.css";
import clsx from "clsx";
import React from "react";

export default function Sponsors({ children }) {
  return <div className={clsx("", styles.sponsorContainer)}>{children}</div>;
}
