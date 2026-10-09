// A stand-in for the Claude Messages API, used only by the end-to-end test.
import http from "node:http";

const requests = [];
const text = (t) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn" });
const tool = (name, input) => ({ content: [{ type: "tool_use", id: "toolu_test", name, input }], stop_reason: "tool_use" });

function reply(body) {
  const tools = (body.tools || []).map((t) => t.name);
  if (tools.includes("record_items")) {
    return tool("record_items", {
      new_items: [{ title: "Share VPN access for the vendor team", owner: "client", owner_name: "Bank IT", due_date: "2030-01-15", quote: "Please share VPN access by 15 Jan." }],
      completed: [],
    });
  }
  if (tools.includes("respond")) {
    const last = body.messages[body.messages.length - 1];
    const q = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
    if (/unknown|backup/i.test(q)) {
      return tool("respond", {
        status: "escalate",
        answer: "That isn't in the documents, so I've passed it to the project team.",
        sources: [],
        suggested_reply: "We take daily backups, kept for [CONFIRM: retention].",
        admin_note: "No backup policy in the sources.",
      });
    }
    return tool("respond", { status: "answered", answer: "You need **3 servers**.", sources: ["HLD v1.3 – §4.5"] });
  }
  const first = body.messages?.[0]?.content;
  if (Array.isArray(first) && first.some((b) => b.type === "document")) return text("## Page text\n\nContent read from the PDF.");
  return text("# Kiosk – Frequently asked questions\n\n## General\n\n**What is the kiosk?**\nA self-service machine.\n");
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/__requests") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(requests));
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      requests.push(body);
      if (body.tool_choice && (body.tool_choice.type === "tool" || body.tool_choice.type === "any")) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: 'tool_choice: type "tool" and "any" are not supported for this model' } }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply(body)));
    });
  })
  .listen(4599, () => console.log("mock Claude listening on 4599"));
