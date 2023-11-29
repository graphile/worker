import Link from "@docusaurus/Link";
import styles from "@site/src/components/Sponsor/styles.module.css";
import clsx from "clsx";
import React from "react";

export default function Sponsor({ name, avatar, href }) {
  return (
    <div className={clsx("", styles.sponsor)}>
      <div>
        <img src={avatar} />
        <a href={href}>{name}</a>
      </div>
    </div>
  );
}
