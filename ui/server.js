const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const {
  ConnectClient,
  ListInstancesCommand,
  ListPromptsCommand,
  ListHoursOfOperationsCommand,
  DescribeHoursOfOperationCommand,
  ListQueuesCommand,
  DescribeQueueCommand,
  ListRoutingProfilesCommand,
  DescribeRoutingProfileCommand,
  ListRoutingProfileQueuesCommand,
  ListContactFlowModulesCommand,
  DescribeContactFlowModuleCommand,
  ListContactFlowsCommand,
  DescribeContactFlowCommand,
  CreateHoursOfOperationCommand,
  UpdateHoursOfOperationCommand,
  CreateQueueCommand,
  CreateRoutingProfileCommand,
  UpdateRoutingProfileDefaultOutboundQueueCommand,
  UpdateRoutingProfileConcurrencyCommand,
  AssociateRoutingProfileQueuesCommand,
  CreateContactFlowModuleCommand,
  UpdateContactFlowModuleContentCommand,
  CreateContactFlowCommand,
  UpdateContactFlowContentCommand,
  AssociateLambdaFunctionCommand,
  ListLambdaFunctionsCommand,
} = require("@aws-sdk/client-connect");
const { fromIni } = require("@aws-sdk/credential-providers");
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

function getClient(profile, region) {
  const opts = { region: region || "us-east-1" };
  if (profile && profile !== "default") {
    opts.credentials = fromIni({ profile });
  }
  return new ConnectClient(opts);
}

async function resolveInstance(client, aliasOrId) {
  try {
    const res = await client.send(new ListInstancesCommand({ MaxResults: 100 }));
    const list = res.InstanceSummaryList || [];
    // Try matching by alias first, then by ID
    const inst =
      list.find((i) => i.InstanceAlias === aliasOrId) ||
      list.find((i) => i.Id === aliasOrId);
    if (!inst) {
      const available = list
        .map((i) => `${i.InstanceAlias} (${i.Id})`)
        .join(", ");
      throw new Error(
        `Instance "${aliasOrId}" not found.${available ? ` Available: ${available}` : " No instances found — check your AWS profile/region."}`
      );
    }
    return inst;
  } catch (e) {
    if (e.name === "CredentialsProviderError" || e.name === "CredentialIsExpired") {
      throw new Error("AWS credentials not found or expired. Check your AWS profile configuration.");
    }
    throw e;
  }
}

// ─── List instances ───
app.get("/api/instances", async (req, res) => {
  try {
    const { profile, region } = req.query;
    const client = getClient(profile, region);
    const result = await client.send(
      new ListInstancesCommand({ MaxResults: 100 })
    );
    res.json(
      (result.InstanceSummaryList || []).map((i) => ({
        id: i.Id,
        alias: i.InstanceAlias,
        arn: i.Arn,
      }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Scan all regions for instances ───
const CONNECT_REGIONS = [
  "us-east-1", "us-west-2", "eu-west-2", "eu-central-1",
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
  "ca-central-1", "af-south-1", "eu-west-1",
];

app.get("/api/scan-regions", async (req, res) => {
  try {
    const { profile } = req.query;
    const found = [];
    const results = await Promise.allSettled(
      CONNECT_REGIONS.map(async (region) => {
        const client = getClient(profile, region);
        const result = await client.send(
          new ListInstancesCommand({ MaxResults: 100 })
        );
        for (const i of result.InstanceSummaryList || []) {
          found.push({
            id: i.Id,
            alias: i.InstanceAlias,
            arn: i.Arn,
            region,
          });
        }
      })
    );
    console.log(`Region scan complete: found ${found.length} instance(s)`);
    res.json(found);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Export (Save) components from source instance ───
app.post("/api/export", async (req, res) => {
  try {
    const { profile, region, instanceAlias, components } = req.body;
    console.log("Export request:", { profile, region, instanceAlias, components });
    const client = getClient(profile, region);
    const inst = await resolveInstance(client, instanceAlias);
    console.log("Found instance:", inst.Id);
    const instanceId = inst.Id;
    const data = { instance: inst, components: {} };

    if (components.includes("prompts")) {
      const r = await client.send(
        new ListPromptsCommand({ InstanceId: instanceId, MaxResults: 100 })
      );
      data.components.prompts = r.PromptSummaryList || [];
    }

    if (components.includes("hours")) {
      const r = await client.send(
        new ListHoursOfOperationsCommand({
          InstanceId: instanceId,
          MaxResults: 100,
        })
      );
      const list = r.HoursOfOperationSummaryList || [];
      const details = [];
      for (const h of list) {
        const d = await client.send(
          new DescribeHoursOfOperationCommand({
            InstanceId: instanceId,
            HoursOfOperationId: h.Id,
          })
        );
        details.push(d.HoursOfOperation);
      }
      data.components.hours = details;
    }

    if (components.includes("queues")) {
      const r = await client.send(
        new ListQueuesCommand({
          InstanceId: instanceId,
          QueueTypes: ["STANDARD"],
          MaxResults: 100,
        })
      );
      const list = (r.QueueSummaryList || []).filter(
        (q) => q.QueueType !== "AGENT"
      );
      const details = [];
      for (const q of list) {
        const d = await client.send(
          new DescribeQueueCommand({
            InstanceId: instanceId,
            QueueId: q.Id,
          })
        );
        details.push(d.Queue);
      }
      data.components.queues = details;
    }

    if (components.includes("routingProfiles")) {
      const r = await client.send(
        new ListRoutingProfilesCommand({
          InstanceId: instanceId,
          MaxResults: 100,
        })
      );
      const list = r.RoutingProfileSummaryList || [];
      const details = [];
      for (const rp of list) {
        const d = await client.send(
          new DescribeRoutingProfileCommand({
            InstanceId: instanceId,
            RoutingProfileId: rp.Id,
          })
        );
        const qs = await client.send(
          new ListRoutingProfileQueuesCommand({
            InstanceId: instanceId,
            RoutingProfileId: rp.Id,
            MaxResults: 100,
          })
        );
        details.push({
          ...d.RoutingProfile,
          AssociatedQueues:
            qs.RoutingProfileQueueConfigSummaryList || [],
        });
      }
      data.components.routingProfiles = details;
    }

    if (components.includes("modules")) {
      const r = await client.send(
        new ListContactFlowModulesCommand({
          InstanceId: instanceId,
          MaxResults: 100,
        })
      );
      const list = r.ContactFlowModulesSummaryList || [];
      const details = [];
      for (const m of list) {
        try {
          const d = await client.send(
            new DescribeContactFlowModuleCommand({
              InstanceId: instanceId,
              ContactFlowModuleId: m.Id,
            })
          );
          if (d.ContactFlowModule.Status === "published") {
            details.push(d.ContactFlowModule);
          }
        } catch (_) {
          // skip unpublished
        }
      }
      data.components.modules = details;
    }

    if (components.includes("flows")) {
      const r = await client.send(
        new ListContactFlowsCommand({
          InstanceId: instanceId,
          MaxResults: 100,
        })
      );
      const list = r.ContactFlowSummaryList || [];
      const details = [];
      for (const f of list) {
        try {
          const d = await client.send(
            new DescribeContactFlowCommand({
              InstanceId: instanceId,
              ContactFlowId: f.Id,
            })
          );
          details.push(d.ContactFlow);
        } catch (_) {
          // skip errors
        }
      }
      data.components.flows = details;
    }

    res.json(data);
  } catch (e) {
    console.error("Export error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Import (Restore) components to destination instance ───
app.post("/api/import", async (req, res) => {
  try {
    const { profile, region, instanceAlias, exportData, components } = req.body;
    const client = getClient(profile, region);
    const inst = await resolveInstance(client, instanceAlias);
    const destInstanceId = inst.Id;
    const destArn = inst.Arn;
    const results = { created: [], updated: [], errors: [] };

    // Parse source ARN to build SED-like remapping
    const sourceArn = exportData.instance.Arn;
    const srcParts = sourceArn.split(":");
    const dstParts = destArn.split(":");
    const srcPrefix = srcParts.slice(0, 5).join(":");
    const dstPrefix = dstParts.slice(0, 5).join(":");
    const srcInstanceId = exportData.instance.Id;

    function remapRefs(content) {
      if (!content) return content;
      let s = typeof content === "string" ? content : JSON.stringify(content);
      s = s.replace(new RegExp(srcInstanceId, "g"), destInstanceId);
      s = s.replace(new RegExp(escapeRegex(srcPrefix), "g"), dstPrefix);
      return s;
    }

    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Build ID mapping from existing destination components
    const idMap = {};

    // ── Hours of Operations ──
    if (components.includes("hours") && exportData.components.hours) {
      const existing = await client.send(
        new ListHoursOfOperationsCommand({
          InstanceId: destInstanceId,
          MaxResults: 100,
        })
      );
      const existingMap = {};
      for (const h of existing.HoursOfOperationSummaryList || []) {
        existingMap[h.Name] = h.Id;
      }

      for (const hour of exportData.components.hours) {
        try {
          const existingId = existingMap[hour.Name];
          if (existingId) {
            idMap[hour.HoursOfOperationId] = existingId;
            await client.send(
              new UpdateHoursOfOperationCommand({
                InstanceId: destInstanceId,
                HoursOfOperationId: existingId,
                Name: hour.Name,
                Description: hour.Description || hour.Name,
                TimeZone: hour.TimeZone,
                Config: hour.Config,
              })
            );
            results.updated.push(`Hours: ${hour.Name}`);
          } else {
            const r = await client.send(
              new CreateHoursOfOperationCommand({
                InstanceId: destInstanceId,
                Name: hour.Name,
                Description: hour.Description || hour.Name,
                TimeZone: hour.TimeZone,
                Config: hour.Config,
              })
            );
            idMap[hour.HoursOfOperationId] = r.HoursOfOperationId;
            results.created.push(`Hours: ${hour.Name}`);
          }
        } catch (e) {
          results.errors.push(`Hours ${hour.Name}: ${e.message}`);
        }
      }
    }

    // ── Queues ──
    if (components.includes("queues") && exportData.components.queues) {
      const existing = await client.send(
        new ListQueuesCommand({
          InstanceId: destInstanceId,
          QueueTypes: ["STANDARD"],
          MaxResults: 100,
        })
      );
      const existingMap = {};
      for (const q of existing.QueueSummaryList || []) {
        existingMap[q.Name] = q.Id;
      }

      for (const queue of exportData.components.queues) {
        try {
          const existingId = existingMap[queue.Name];
          if (existingId) {
            idMap[queue.QueueId] = existingId;
            results.updated.push(`Queue: ${queue.Name} (exists, skipped update)`);
          } else {
            const hoursId =
              idMap[queue.HoursOfOperationId] || queue.HoursOfOperationId;
            const r = await client.send(
              new CreateQueueCommand({
                InstanceId: destInstanceId,
                Name: queue.Name,
                Description: queue.Description || queue.Name,
                HoursOfOperationId: hoursId,
              })
            );
            idMap[queue.QueueId] = r.QueueId;
            results.created.push(`Queue: ${queue.Name}`);
          }
        } catch (e) {
          results.errors.push(`Queue ${queue.Name}: ${e.message}`);
        }
      }
    }

    // ── Routing Profiles ──
    if (
      components.includes("routingProfiles") &&
      exportData.components.routingProfiles
    ) {
      const existing = await client.send(
        new ListRoutingProfilesCommand({
          InstanceId: destInstanceId,
          MaxResults: 100,
        })
      );
      const existingMap = {};
      for (const rp of existing.RoutingProfileSummaryList || []) {
        existingMap[rp.Name] = rp.Id;
      }

      for (const rp of exportData.components.routingProfiles) {
        try {
          const existingId = existingMap[rp.Name];
          if (existingId) {
            idMap[rp.RoutingProfileId] = existingId;
            results.updated.push(`Routing Profile: ${rp.Name} (exists)`);
          } else {
            const doqId =
              idMap[rp.DefaultOutboundQueueId] || rp.DefaultOutboundQueueId;
            const mediaConcurrencies = (rp.MediaConcurrencies || []).filter(
              (m) => m.Concurrency > 0
            );
            const r = await client.send(
              new CreateRoutingProfileCommand({
                InstanceId: destInstanceId,
                Name: rp.Name,
                Description: rp.Description || rp.Name,
                DefaultOutboundQueueId: doqId,
                MediaConcurrencies: mediaConcurrencies,
              })
            );
            idMap[rp.RoutingProfileId] = r.RoutingProfileId;
            results.created.push(`Routing Profile: ${rp.Name}`);
          }
        } catch (e) {
          results.errors.push(`Routing Profile ${rp.Name}: ${e.message}`);
        }
      }
    }

    // ── Contact Flow Modules ──
    if (components.includes("modules") && exportData.components.modules) {
      const existing = await client.send(
        new ListContactFlowModulesCommand({
          InstanceId: destInstanceId,
          MaxResults: 100,
        })
      );
      const existingMap = {};
      for (const m of existing.ContactFlowModulesSummaryList || []) {
        existingMap[m.Name] = m.Id;
      }

      // First pass: create stubs for new modules
      for (const mod of exportData.components.modules) {
        const existingId = existingMap[mod.Name];
        if (existingId) {
          idMap[mod.Id] = existingId;
        } else {
          try {
            const r = await client.send(
              new CreateContactFlowModuleCommand({
                InstanceId: destInstanceId,
                Name: mod.Name,
                Content: JSON.stringify({
                  Version: "2019-10-30",
                  StartAction: "stub",
                  Actions: [
                    {
                      Identifier: "stub",
                      Type: "EndFlowModuleExecution",
                      Parameters: {},
                      Transitions: {},
                    },
                  ],
                  Settings: {
                    InputParameters: [],
                    OutputParameters: [],
                    Transitions: [],
                  },
                }),
              })
            );
            idMap[mod.Id] = r.Id;
            results.created.push(`Module: ${mod.Name}`);
          } catch (e) {
            results.errors.push(`Module ${mod.Name}: ${e.message}`);
          }
        }
      }

      // Second pass: update content with remapped refs
      for (const mod of exportData.components.modules) {
        const destId = idMap[mod.Id] || existingMap[mod.Name];
        if (!destId || !mod.Content) continue;
        try {
          let content = remapRefs(mod.Content);
          // Remap all known IDs
          for (const [srcId, dstId] of Object.entries(idMap)) {
            content = content.replace(new RegExp(escapeRegex(srcId), "g"), dstId);
          }
          await client.send(
            new UpdateContactFlowModuleContentCommand({
              InstanceId: destInstanceId,
              ContactFlowModuleId: destId,
              Content: content,
            })
          );
          results.updated.push(`Module content: ${mod.Name}`);
        } catch (e) {
          results.errors.push(`Module content ${mod.Name}: ${e.message}`);
        }
      }
    }

    // ── Contact Flows ──
    if (components.includes("flows") && exportData.components.flows) {
      const existing = await client.send(
        new ListContactFlowsCommand({
          InstanceId: destInstanceId,
          MaxResults: 100,
        })
      );
      const existingMap = {};
      for (const f of existing.ContactFlowSummaryList || []) {
        existingMap[f.Name] = { id: f.Id, type: f.ContactFlowType };
      }

      // First pass: create stubs
      for (const flow of exportData.components.flows) {
        const ex = existingMap[flow.Name];
        if (ex) {
          idMap[flow.Id] = ex.id;
        } else {
          try {
            const r = await client.send(
              new CreateContactFlowCommand({
                InstanceId: destInstanceId,
                Name: flow.Name,
                Type: flow.Type || "CONTACT_FLOW",
                Content: JSON.stringify({
                  Version: "2019-10-30",
                  StartAction: "stub",
                  Metadata: {
                    entryPointPosition: { x: 20, y: 20 },
                    snapToGrid: false,
                    ActionMetadata: {
                      stub: { position: { x: 120, y: 20 } },
                    },
                  },
                  Actions: [
                    {
                      Identifier: "stub",
                      Type: "DisconnectParticipant",
                      Parameters: {},
                      Transitions: {},
                    },
                  ],
                }),
              })
            );
            idMap[flow.Id] = r.ContactFlowId;
            results.created.push(`Flow: ${flow.Name}`);
          } catch (e) {
            results.errors.push(`Flow ${flow.Name}: ${e.message}`);
          }
        }
      }

      // Second pass: update content
      for (const flow of exportData.components.flows) {
        const destId = idMap[flow.Id] || (existingMap[flow.Name] || {}).id;
        if (!destId || !flow.Content) continue;
        try {
          let content = remapRefs(flow.Content);
          for (const [srcId, dstId] of Object.entries(idMap)) {
            content = content.replace(new RegExp(escapeRegex(srcId), "g"), dstId);
          }
          await client.send(
            new UpdateContactFlowContentCommand({
              InstanceId: destInstanceId,
              ContactFlowId: destId,
              Content: content,
            })
          );
          results.updated.push(`Flow content: ${flow.Name}`);
        } catch (e) {
          results.errors.push(`Flow content ${flow.Name}: ${e.message}`);
        }
      }

      // Associate Lambda functions
      try {
        const lambdaArns = new Set();
        for (const flow of exportData.components.flows) {
          if (!flow.Content) continue;
          let c = remapRefs(flow.Content);
          for (const [srcId, dstId] of Object.entries(idMap)) {
            c = c.replace(new RegExp(escapeRegex(srcId), "g"), dstId);
          }
          const parsed = typeof c === "string" ? JSON.parse(c) : c;
          for (const action of parsed.Actions || []) {
            if (
              action.Type === "InvokeLambdaFunction" &&
              action.Parameters?.LambdaFunctionARN
            ) {
              lambdaArns.add(action.Parameters.LambdaFunctionARN);
            }
          }
        }

        if (lambdaArns.size > 0) {
          const existingLambdas = await client.send(
            new ListLambdaFunctionsCommand({ InstanceId: destInstanceId })
          );
          const existingSet = new Set(existingLambdas.LambdaFunctions || []);
          for (const arn of lambdaArns) {
            if (!existingSet.has(arn)) {
              try {
                await client.send(
                  new AssociateLambdaFunctionCommand({
                    InstanceId: destInstanceId,
                    FunctionArn: arn,
                  })
                );
                results.created.push(`Lambda association: ${arn}`);
              } catch (e) {
                results.errors.push(`Lambda ${arn}: ${e.message}`);
              }
            }
          }
        }
      } catch (_) {
        // non-critical
      }
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Amazon Connect Copy UI running at http://localhost:${PORT}`);
});
