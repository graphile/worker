import { rand } from "../blah.js";
export default (_payload, helpers) => {
  helpers.logger.debug(rand());
  return "some sausages";
};
