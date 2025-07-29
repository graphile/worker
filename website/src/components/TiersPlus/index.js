import Link from "@docusaurus/Link";
import styles from "@site/src/components/TiersPlus/styles.module.css";
import clsx from "clsx";
import React from "react";

const TierList = [
  {
    title: "Monthly Plan",
    tagline: "Pay month-to-month with full flexibility",
    pricing: "$999",
    was: "$1,500",
    link: "https://github.com/sponsors/benjie/sponsorships?tier_id=42012",
    buttonText: "",
    frequency: "per month",
    comparison: "",
    description: (
      <>
        <ul>
          <li>All the benefits of a Featured Sponsor and...</li>
          <li>One-to-one access to the Graphile team throughout the year </li>
          <li>
            <strong>Priority support straight from the maintainer</strong>
          </li>
          <li>
            Add the Graphile team to your chat server for timely responses
          </li>
          <li>Add the Graphile team to your GitHub/GitLab organization</li>
          <li>Reference your code verbatim</li>
          <li>Calls arranged as required</li>
          <li>NDA available</li>
          <li>
            <strong>Access to discounted consultancy packages</strong>
          </li>
          <li>
            The warm feeling that comes from knowing{" "}
            <strong>
              you’re making a significant difference to Graphile Worker’s
              development and sustainability
            </strong>
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Annual Plan",
    tagline: "Maximum savings with full year commitment",
    pricing: "$9,999",
    was: "$11,988",
    link: "mailto:team@graphile.com?subject=Private%20Advisor%20enquiry",
    buttonText: "",
    frequency: "per year",
    comparison: "That's just $833.25/month",
    badge: "Best Value - Save $1,999 ",
    featured: true,
    description: (
      <>
        <ul>
          <li>All the benefits of a Featured Sponsor and...</li>
          <li>One-to-one access to the Graphile team throughout the year </li>
          <li>
            <strong>Priority support straight from the maintainer</strong>
          </li>
          <li>
            Add the Graphile team to your chat server for timely responses
          </li>
          <li>Add the Graphile team to your GitHub/GitLab organization</li>
          <li>Reference your code verbatim</li>
          <li>Calls arranged as required</li>
          <li>NDA available</li>
          <li>
            <strong>Access to discounted consultancy packages</strong>
          </li>
          <li>
            The warm feeling that comes from knowing{" "}
            <strong>
              you’re making a significant difference to Graphile Worker’s
              development and sustainability
            </strong>
          </li>
        </ul>
      </>
    ),
  },
];

function Tier({
  title,
  tagline,
  link,
  buttonText,
  description,
  pricing,
  was,
  frequency,
  comparison,
  badge,
  featured,
}) {
  return (
    <div className={clsx(styles.tier, featured ? styles.featured : null)}>
      {badge ? <div className={styles.badge}>{badge}</div> : null}
      <div className={styles.banner}>
        <div className={styles.info}>
          <h2 className={styles.title}>{title}</h2>
          <h3 className={styles.tagline}>{tagline}</h3>
          <h3 className={styles.tagline}>
            <span className={styles.was}>{was}</span>
            <br />
            <span className={styles.price}>{pricing}</span>&nbsp;
            <span className={styles.note}>{frequency}</span>
            <span className={styles.note}>{comparison}</span>
          </h3>
        </div>
        <div className={styles.info}>
          <Link
            className={clsx("button button--primary button--lg", styles.button)}
            to={link}
          >
            {buttonText}
          </Link>
        </div>
      </div>
      <p>{description}</p>
    </div>
  );
}

export default function List() {
  return (
    <section className="padding-vert--sm">
      <div className={styles.tiers}>
        <div className={clsx(styles.tierRow)}>
          {TierList.map((props, idx) => (
            <Tier key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
