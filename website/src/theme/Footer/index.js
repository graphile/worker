import FooterImage from "@site/static/img/homepage/ant-footer.svg";
import Footer from "@theme-original/Footer";
import React from "react";

import styles from "./index.module.css";

export default function FooterWrapper(props) {
  return (
    <>
      <div className={styles.imageContainer}>
        <FooterImage
          className={styles.footerImage}
          title="Three ants crawling atop the footer"
        />
      </div>
      <Footer {...props} />
    </>
  );
}
