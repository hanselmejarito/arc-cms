export async function loadSessionBootstrap(getSession, loadWorkspace) {
  const { user } = await getSession()
  if (!user) return { authenticated: false }
  const data = await loadWorkspace()
  return { authenticated: true, user, data }
}
