/* eslint-disable @typescript-eslint/no-var-requires */

import clsx from "clsx";
import React from "react";

import styles from "./styles.module.css";

const FeatureList = [
  {
    title: "Reliable",
    Svg: require("@site/static/img/homepage/reliable.svg").default,
    description: (
      <>
        Automatic retries with automatic exponential backoff; built on Postgres'
        reliable transactions. Never lose a job.
      </>
    ),
  },
  {
    title: "High Performance",
    Svg: require("@site/static/img/homepage/performance.svg").default,
    description: (
      <>
        Up to 10,000 jobs per second; keep your infrastructure simple (just
        Postgres and Node) and focus on your project!
      </>
    ),
  },
  {
    title: "Low Latency",
    Svg: require("@site/static/img/homepage/latency.svg").default,
    description: (
      <>
        Jobs start in milliseconds thanks to Postgres' LISTEN/NOTIFY; delight
        customers with near real-time background processing.
      </>
    ),
  },
  {
    title: "Cron Jobs",
    Svg: require("@site/static/img/homepage/cron-jobs.svg").default,
    description: (
      <>
        Set up repeating tasks with minute-by-minute granularity; optional
        backfill to cover times when your servers weren't running.
      </>
    ),
  },
  {
    title: "Job Control",
    Svg: require("@site/static/img/homepage/job-control.svg").default,
    description: (
      <>
        Schedule jobs to run in the future. Debounce jobs to avoid redundant
        work. Cancel or update scheduled jobs.
      </>
    ),
  },
  {
    title: "Easy Migration",
    Svg: require("@site/static/img/homepage/migration.svg").default,
    description: (
      <>
        Want to migrate to a dedicated job queue later? No problem! Examples of
        exporting jobs to other queues are included!
      </>
    ),
  },
];

function Feature({ Svg, title, description }) {
  return (
    <div className={clsx("col col--6 padding-vert--md", styles.feature)}>
      <div className={styles.svgContainer}>
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className={styles.featureDetails}>
        <h2 className={styles.featureTitle}>{title}</h2>
        <h3 className={styles.featureInfo}>{description}</h3>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={clsx("row", styles.row)}>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
