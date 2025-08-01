import Link from "@docusaurus/Link";
import styles from "@site/src/components/TierPlusButtons/styles.module.css";
import clsx from "clsx";
import React from "react";

export default function TierPlusButtons() {
  return (
    <div className={clsx(styles.sponsorbuttons)}>
      <Link
        className={clsx(
          "button button--primary button--lg",
          styles.sponsorbutton,
        )}
        to="https://github.com/users/benjie/sponsorship"
      ></Link>
      <Link
        className={clsx(
          "button button--primary button--lg",
          styles.borderbutton,
        )}
        to="mailto:team@graphile.com?subject=Private%20Advisor%20enquiry"
      ></Link>
    </div>
  );
}
