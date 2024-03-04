import { library } from "@fortawesome/fontawesome-svg-core";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import MDXComponents from "@theme-original/MDXComponents";

library.add(fab, fas);

export default {
  ...MDXComponents,
  Icon: FontAwesomeIcon,
};
