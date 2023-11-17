import { rand } from "../blah";
export default (_payload, helpers) => {
  helpers.logger.debug(rand());
  return "some sausages";
};
