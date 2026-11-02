export function localizedError(message) {
  const error = new Error(message)
  error.localized = true
  return error
}

// Only messages authored in the app may reach the interface. Browser, network
// and database exceptions can contain English or internal implementation data.
export function userError(error, fallback = 'Ntibyashobotse. Ongera ugerageze.') {
  return error?.localized === true ? error.message : fallback
}
