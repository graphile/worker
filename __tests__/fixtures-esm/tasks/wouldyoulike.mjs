import { rand } from "../blah.mjs";
export default (_payload, helpers) => {
  helpers.logger.debug(rand());
  return "some sausages";
};
