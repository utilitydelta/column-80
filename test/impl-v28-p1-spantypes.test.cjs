// IMPLEMENTER tests - session-v28 phase 1, the five defects that only production
// code produced. Every fixture below is a VERBATIM shape lifted from the repos
// the measurement ran against (a 162-file C# solution, a 439-file Rust crate
// workspace); none of them is reachable in the dogfood playgrounds, which is why
// the blind contract set is green on all 51 rows and every one of these was
// broken.
//
// Companion to test/blind-v28-p1-spansurface.test.cjs, which is frozen. Where a
// row here overlaps a row there, the frozen one wins.
//
// Run: SKIP_LIVE=1 node --test test/impl-v28-p1-spantypes.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v28-p1-spantypes",
  `export { spanTypesInPlay } from "../src/core/repairTypes";
export { undisclosedMemberRefusal } from "../src/core/repairGate";\n`,
);
const { spanTypesInPlay, undisclosedMemberRefusal } = mod;
test.after(cleanup);

const show = (v) => JSON.stringify(v);

// ===========================================================================
// 1. THE OBJECT INITIALIZER. C# writes a comma-terminated list of PascalCase
// property names, one per line, and the generic-argument leg's `\s*` crossed the
// newline to read every one of them as a type. 685 candidate slots in one
// solution. Verbatim from Contoso.LocalBackupTool/Program.cs.
// ===========================================================================

const INITIALIZER = `private static DataModel.Cosmos.DpmEvent CreateCosmosDpmEvent(BaseDpmEvent entity)
{
    var item = new DataModel.Cosmos.DpmEvent()
    {
        AmbientPressure = entity.AmbientPressure,
        _ts = entity._ts,
        AmbientTemp = entity.AmbientTemp,
        AmplifierCurrent = entity.AmplifierCurrent,
        BatteryVoltage = entity.BatteryVoltage,
        BlowerCurrent = entity.BlowerCurrent,
        BlowerSpeed = entity.BlowerSpeed,
        CalibrationValue = entity.CalibrationValue,
        DarkLightReading = entity.DarkLightReading,
        DPMValue = entity.DPMValue,
        Excluded = entity.Excluded,
        FirmwareVersion = entity.FirmwareVersion,
    };
    return item;
}`;

test("1 [csharp]: an object initializer's property names are not types in play", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "private static DataModel.Cosmos.DpmEvent CreateCosmosDpmEvent(BaseDpmEvent entity)",
    code: INITIALIZER,
  });
  for (const property of [
    "AmbientPressure", "AmbientTemp", "AmplifierCurrent", "BatteryVoltage",
    "BlowerCurrent", "BlowerSpeed", "CalibrationValue", "DarkLightReading",
    "Excluded", "FirmwareVersion",
  ]) {
    assert.ok(
      !out.includes(property),
      `${property} is a property assigned in an initializer, not a type. The line above it ends in a comma, and a comma at the end of a line is not a generic-argument position. Got ${show(out)}`,
    );
  }
  assert.ok(out.includes("BaseDpmEvent"), `the parameter's type survives; got ${show(out)}`);
});

test("1 [csharp]: a same-line generic argument is still a type in play", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public void Load(Dictionary<string, Monitor> monitorsByHash, Dictionary<string, Site> sitesByHash)",
    code: `public void Load(Dictionary<string, Monitor> monitorsByHash, Dictionary<string, Site> sitesByHash)
{
    var pairs = new List<KeyValuePair<string, ShiftHour>>();
}`,
  });
  for (const type of ["Monitor", "Site", "ShiftHour"]) {
    assert.ok(out.includes(type), `${type} sits after a comma on its own line, which is the generic-argument position the leg exists for; got ${show(out)}`);
  }
});

test("1 [typescript]: a generic list opened at the end of a line still yields its first argument", () => {
  const out = spanTypesInPlay({
    languageId: "typescript",
    signature: "export const DialogOverlay = React.forwardRef<ElementRef, OverlayProps>",
    code: `const DialogOverlay = React.forwardRef<
  ElementRef,
  OverlayProps
>(({ className, ...props }, ref) => null);`,
  });
  assert.ok(
    out.includes("ElementRef"),
    `a \`<\` that ends a line opens a generic list and means nothing else, so that half of the leg may cross the newline; got ${show(out)}`,
  );
});

// ===========================================================================
// 2. THE NAMESPACE SEGMENT. `DataModel.Enums.ThreatLevel` is ONE type spelled
// the long way. The scan read it as three, and on the real repair round the two
// namespaces took two of the four budget slots and dropped `ICommonDpmEvent`,
// which carried the fix. Verbatim from
// Contoso.ProcessingLogic/Service/AdditionalDataProcessing.cs.
// ===========================================================================

const THREAT_LEVEL = `public DataModel.Enums.ThreatLevel GetThreatLevel(EventMetadata eventMetadata, ICommonDpmEvent row)
{
    var monitor = string.IsNullOrEmpty(row.SerialNumber) ? eventMetadata.MonitorsByHash[row.MonitorHash] : eventMetadata.MonitorsByName[row.SerialNumber];
    var site = eventMetadata.SitesByHash[monitor.SiteHash];

    if (row.DPMValue <= site.GreenDPM)
    {
        return DataModel.Enums.ThreatLevel.Minor;
    }

    return DataModel.Enums.ThreatLevel.Severe;
}`;

test("2 [csharp]: a namespace segment is not a type, and the type it qualifies is", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public DataModel.Enums.ThreatLevel GetThreatLevel(EventMetadata eventMetadata, ICommonDpmEvent row)",
    code: THREAT_LEVEL,
  });
  for (const namespaceSegment of ["DataModel", "Enums"]) {
    assert.ok(
      !out.includes(namespaceSegment),
      `${namespaceSegment} is a namespace. It resolves to nothing and holds a slot a collaborator needed: this exact pair dropped ICommonDpmEvent from the surface of the round that had to fix a member on it. Got ${show(out)}`,
    );
  }
  for (const type of ["ThreatLevel", "EventMetadata", "ICommonDpmEvent"]) {
    assert.ok(out.includes(type), `${type} is a real collaborator of this span; got ${show(out)}`);
  }
});

test("2 [csharp]: a member access is not a path, so the qualifier is still the type", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public int RegionLodCount(List<Tile> tiles)",
    code: `public int RegionLodCount(List<Tile> tiles)
{
    return tiles.Count(tile => tile.Lod == LodBand.Regional);
}`,
  });
  assert.ok(
    out.includes("LodBand"),
    `\`Regional\` is a member and \`LodBand\` is the type. What tells the two shapes apart is whether the name after the dot is itself followed by a dot; got ${show(out)}`,
  );
});

test("2 [csharp]: the last qualifier of a dotted path is the candidate", () => {
  const out = spanTypesInPlay({
    languageId: "csharp",
    signature: "public void Check(FileParsingResults file)",
    code: `public void Check(FileParsingResults file)
{
    if (file.DataOrigin == DataModel.Enums.DataOrigin.None)
    {
        return;
    }
}`,
  });
  assert.ok(out.includes("DataOrigin"), `the enum carrying the fix must be in play; got ${show(out)}`);
  assert.ok(!out.includes("DataModel") && !out.includes("Enums"), `its containers must not be; got ${show(out)}`);
});

// ===========================================================================
// 3. RUST'S `::`. The annotation leg matched the SECOND colon of `::`, so every
// path segment after one scanned as an annotated type: 4367 candidate slots in
// acme-db, the largest single junk class in the measurement and in the
// product's founding language. Verbatim from acme_bench/src/history.rs.
// ===========================================================================

const RUST_PUSH = `fn push(&self, line: &HistoryLine) {
    let json = match serde_json::to_string(line) {
        Ok(j) => j,
        Err(_) => {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
    };
    match self.tx.try_send(json) {
        Ok(()) => {
            self.written.fetch_add(1, Ordering::Relaxed);
        }
        Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}`;

test("3 [rust]: an enum variant after `::` is not a type, and its owner still is", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn push(&self, line: &HistoryLine)",
    code: RUST_PUSH,
  });
  for (const variant of ["Relaxed", "Full", "Disconnected"]) {
    assert.ok(
      !out.includes(variant),
      `${variant} is a variant reached through \`::\`, and the annotation position is a SINGLE colon. Got ${show(out)}`,
    );
  }
  for (const type of ["TrySendError", "HistoryLine"]) {
    assert.ok(out.includes(type), `${type} owns the path and is a type worth resolving; got ${show(out)}`);
  }
  assert.ok(!out.includes("Ordering"), `\`Ordering\` owns a path and is std, so the std set stops it before the position ever matters; got ${show(out)}`);
});

test("3 [rust]: a real annotation colon still names its type", () => {
  const out = spanTypesInPlay({
    languageId: "rust",
    signature: "fn build(&self) -> HistorySummary",
    code: `fn build(&self) -> HistorySummary {
    let cursor: Cursor = self.cursor.clone();
    let placement: Placement = Placement::Fixed;
    HistorySummary { cursor, placement }
}`,
  });
  for (const type of ["Cursor", "Placement", "HistorySummary"]) {
    assert.ok(out.includes(type), `${type} is annotated with one colon, which is the position the leg is for; got ${show(out)}`);
  }
  assert.ok(!out.includes("Fixed"), `\`Placement::Fixed\` is a variant; got ${show(out)}`);
});

// ===========================================================================
// 4. THE GATE REFUSES CORRECT CODE. `Enums.JobStatus` is the qualified spelling
// of a type, and the type-as-member leg read it as a type named as a member of a
// value, because a namespace is never a disclosed type. 2 of 60 pristine spans
// from the real solution refused, each of which would cost a human a repair
// round for writing correct C#. Verbatim from
// Contoso.DataModel/Service/MetadataInteractions.cs and RetrospectiveJobs.cs.
// ===========================================================================

const JOB_STATUS = { name: "JobStatus", members: ["pending", "running", "completed", "failed"], complete: true };
const RETRO_JOB = { name: "RetroJob", members: ["Status", "RowsProcessed", "PercentComplete", "CreatedAt"], complete: false };

test("4 gate: a namespace-qualified type is correct code and is not refused", () => {
  assert.equal(
    undisclosedMemberRefusal(
      `return await metadataContext.RetroJobs.AsNoTracking()
    .Where(x => (x.Status != Enums.JobStatus.completed && x.Status != Enums.JobStatus.failed) || x.CreatedAt > DateTime.UtcNow.AddDays(-2))
    .ToListAsync();`,
      [JOB_STATUS, RETRO_JOB],
    ),
    undefined,
    "`Enums.JobStatus` names a type through its namespace. A namespace is not a value, and the leg's rule is that a type is not a member of a VALUE",
  );
});

test("4 gate: the same shape in an object initializer is not refused either", () => {
  assert.equal(
    undisclosedMemberRefusal(
      `var job = new RetroJob()
{
    CreatedAt = DateTime.UtcNow,
    PercentComplete = 0,
    RowsProcessed = 0,
    Status = Enums.JobStatus.pending,
};`,
      [JOB_STATUS, RETRO_JOB],
    ),
    undefined,
  );
});

test("4 gate: the captured invention still refuses", () => {
  const tile = { name: "Tile", members: ["Band", "Lod", "Weight"], complete: true };
  const lodBand = { name: "LodBand", members: ["Continental", "Municipal", "Parcel", "Regional"], complete: true };
  const why = undisclosedMemberRefusal("return tiles.Count(tile => tile.LodBand == LodBand.Regional);", [tile, lodBand]);
  assert.equal(
    typeof why,
    "string",
    "`tile` is a value, so a type named as its member is still the invention that shipped into the human's file",
  );
});

// ===========================================================================
// 5. THE CLOSED SET LOSES THE SHARED RENDER BUDGET. A 46-member DTO and a
// 25-member parsing result consume the shared data-shape budget first-come, and
// a four-variant enum then renders zero lines. Measured at three of the ten
// real repair spans. The fixture mirrors that shape: one wide open class and one
// narrow closed enum, both real candidates of the same span.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v28-p1-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (arg) => (typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg)));
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__IMPL_V28P1_FILES__ || {};
      return Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => files[keyOf(arg)] });
    },
  },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v28-p1-spantypes-v.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v28-p1-spantypes-v.bundle.cjs");
fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolvePrefill } = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const URI = "file:///w/v28/Loading.cs";
const SRC = `public class FileLoading
{
    public void SetMonitorHash(FileParsingResults file)
    {
        if (file.DataOrigin == DataOrigin.None)
        {
            return;
        }
    }
}
`;

// A 46-member DTO, the width the real `ICsvMonitor` carries, and a four-variant
// enum. The member lines are the real renderer's shape (`Name : type`). The
// member WIDTH is the fixture's dial: at 46 the two surfaces cannot both fit the
// shared budget and the ordering decides who lives, at 8 they both fit and the
// ordering only decides who reads first. Both cases are real, and the second is
// what stops the first being a rule that drops wide types on principle.
const wideMembers = (count) =>
  Array.from({ length: count }, (_, i) => ({
    name: `LocationAverageReading${String(i).padStart(2, "0")}`,
    signature: `LocationAverageReading${String(i).padStart(2, "0")} : IReadOnlyList<double>`,
    kind: "property",
  }));
const VARIANTS = ["None", "AAMS", "DPMPortal", "Retrospective"].map((v) => ({
  name: v,
  signature: `DataOrigin.${v} = 0`,
  kind: "enumMember",
}));

function extractor(WIDE_MEMBERS) {
  const typeAt = (c) => {
    const line = SRC.split("\n")[c.line] ?? "";
    if (/\bFileParsingResults\b/.test(line)) return "FileParsingResults";
    if (/\bDataOrigin\b/.test(line)) return "DataOrigin";
    return undefined;
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      return t ? { uri: URI, range: { startLine: c.line, startCharacter: 0, endLine: c.line, endCharacter: 1 } } : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      if (t === "FileParsingResults") return { signature: "class Contoso.DataModel.FileParsingResults" };
      if (t === "DataOrigin") return { signature: "enum Contoso.DataModel.Enums.DataOrigin" };
      return undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      if (t === "FileParsingResults") return WIDE_MEMBERS;
      if (t === "DataOrigin") return VARIANTS;
      return [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

async function prefill(memberCount) {
  globalThis.__IMPL_V28P1_FILES__ = { [URI]: SRC };
  const start = SRC.indexOf("public void SetMonitorHash");
  const doc = (() => {
    const lines = SRC.split("\n");
    const offsetAt = (p) => {
      let o = 0;
      for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
      return Math.min(o + p.character, SRC.length);
    };
    const positionAt = (off) => {
      let o = 0;
      for (let l = 0; l < lines.length; l++) {
        if (off <= o + lines[l].length) return { line: l, character: off - o };
        o += lines[l].length + 1;
      }
      return { line: lines.length - 1, character: 0 };
    };
    return { uri: { toString: () => URI }, offsetAt, positionAt, getText: (r) => (r ? SRC.slice(offsetAt(r.start), offsetAt(r.end)) : SRC) };
  })();
  const resolved = {
    span: { start, end: SRC.lastIndexOf("}\n}") },
    signature: "public void SetMonitorHash(FileParsingResults file)",
    docComment: undefined,
    symbolName: "SetMonitorHash",
    languageId: "csharp",
    kind: "function",
  };
  const logs = [];
  const disclosed = [];
  const surface = await resolvePrefill(extractor(wideMembers(memberCount)), doc, resolved, (l) => logs.push(l), {
    extraCandidates: ["FileParsingResults", "DataOrigin"],
    omitInstruction: true,
    onDisclosed: (t) => disclosed.push(...t),
  });
  return { surface: surface ?? "", logs, disclosed };
}

test("5 [csharp]: a wide open class does not evict a closed enum from the shared budget", async () => {
  const { surface, logs, disclosed } = await prefill(46);
  assert.ok(
    logs.some((l) => /budget exhausted; `FileParsingResults`/.test(l)),
    `fixture precondition: the two surfaces cannot both fit, or this proves nothing about who wins. Logs: ${show(logs)}`,
  );
  assert.ok(
    surface.includes("Members of `DataOrigin`"),
    `the enum is the whole of what its type can answer to and the class's list is a subset however many lines it gets, so the enum takes the budget first. Logs: ${show(logs)}`,
  );
  for (const variant of ["None", "AAMS", "DPMPortal", "Retrospective"]) {
    assert.ok(surface.includes(variant), `every variant renders - four lines is the whole surface; got ${surface.slice(0, 400)}`);
  }
  assert.ok(
    disclosed.some((d) => d.name === "DataOrigin" && d.complete === true),
    `a rendered closed set is what the repair gate is allowed to refuse against; got ${show(disclosed)}`,
  );
});

test("5 [csharp]: with room for both, the wide class still renders - it just goes second", async () => {
  const { surface, logs } = await prefill(8);
  assert.ok(
    !logs.some((l) => /budget exhausted/.test(l)),
    `fixture precondition: both surfaces must fit here. Logs: ${show(logs)}`,
  );
  assert.ok(surface.includes("Members of `FileParsingResults`"), `closed FIRST is the rule, not closed INSTEAD; got ${surface.slice(0, 300)}`);
  assert.ok(
    surface.indexOf("Members of `DataOrigin`") < surface.indexOf("Members of `FileParsingResults`"),
    "the closed set leads the payload",
  );
});
