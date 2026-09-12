let reportedError: string | undefined;

export const createConfiguredRegex = (
  pattern: string,
  flags: string,
  reportError: (message: string) => void
): RegExp => {
  try {
    const regex = pattern ? new RegExp(pattern, flags) : /(?=a)b/g;
    reportedError = undefined;
    return regex;
  } catch (error) {
    const message = `Invalid todo.embedded.regex or todo.embedded.regexFlags: ${error.message}`;
    if (message !== reportedError) {
      reportedError = message;
      reportError(message);
    }
    return /(?=a)b/g;
  }
};
