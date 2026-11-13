// Projektdaten (Transkript, Video-Pfad) nur mit gültiger Sitzung
import { projectId, loadProject, readSession, send } from "./_lib.js";

export default async function handler(req, res) {
  const id = projectId(req.query.project);
  const project = id && loadProject(id);
  if (!project) return send(res, 404, { error: "Projekt nicht gefunden" });
  const session = readSession(req, id);
  if (!session) return send(res, 401, { error: "Bitte anmelden", title: project.title });
  return send(res, 200, { me: session.n, project });
}
