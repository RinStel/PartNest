import bridgeSource from "../../../src-tauri/resources/bridge-v1.js?raw";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 回归基线：bridge 脚本运行在不可信的 BOM 文档内，它的每一条选中判定都会直接影响
 * 库存取用，因此规则本身必须被测试约束。加载的是仓库内第一方脚本（`?raw` 导入，
 * 非外部输入），用 Function 构造只为把它当作独立文档脚本执行；每个用例拿到自己的
 * document，避免上一个用例注册的监听器和 MutationObserver 继续向同一个 spy 发消息。
 */
type Spy = ReturnType<typeof vi.spyOn>;

type Harness = { spy: Spy; doc: Document };

function loadBridge(markup: string, designators: string[]): Harness {
  const doc = document.implementation.createHTMLDocument("被测 BOM");
  doc.body.innerHTML = markup;
  /* 脚本靠 window.parent.postMessage 上报，这里用最小 window 替身，parent 指向宿主。 */
  const scope = { parent: window, __PARTNEST_BOM_BRIDGE_V1__: { token: "token-1", designators } };
  const spy = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
  new Function("window", "document", bridgeSource)(scope, doc);
  return { spy, doc };
}

async function reportedDesignators(spy: Spy): Promise<string[][]> {
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
  return spy.mock.calls
    .map(([message]) => (message as { designators?: string[] }).designators ?? [])
    .filter((designators) => designators.length > 0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("交互式 BOM bridge", () => {
  it("在操作者交互之前保持沉默", async () => {
    const { spy, doc } = loadBridge(`<div class="selected"><span>R1</span></div>`, ["R1", "R2"]);

    window.dispatchEvent(new Event("load"));
    doc.querySelectorAll("span")[0].setAttribute("class", "selected active");

    expect(await reportedDesignators(spy)).toEqual([]);
  });

  it("忽略只是包含 selected 字样的类名", async () => {
    const { spy, doc } = loadBridge(`
      <span class="deselected">R1</span>
      <table><tbody><tr><td>R2</td></tr></tbody></table>`, ["R1", "R2"]);

    doc.querySelectorAll("tr")[0].click();

    expect(await reportedDesignators(spy)).toEqual([["R2"]]);
  });

  it("点击任意位置后上报被标记的那一行", async () => {
    const { spy, doc } = loadBridge(`
      <table><tbody>
        <tr class="selected"><td data-designator="R1">R1</td></tr>
        <tr><td data-designator="R2">R2</td></tr>
      </tbody></table>`, ["R1", "R2"]);

    doc.querySelectorAll("tr")[1].click();

    expect(await reportedDesignators(spy)).toEqual([["R1"]]);
  });

  it("超过上限的选择一律不发送", async () => {
    const designators = Array.from({ length: 513 }, (_, index) => `R${index}`);
    const { spy, doc } = loadBridge(designators
      .map((value) => `<span class="selected" data-designator="${value}">${value}</span>`)
      .join(""), designators);

    doc.querySelectorAll("span")[0].click();

    expect(await reportedDesignators(spy)).toEqual([]);
  });

  it("只上报属于当前 BOM 的位号", async () => {
    const { spy, doc } = loadBridge(`<table><tbody><tr class="selected"><td data-designator="R9">R9</td><td data-designator="R1">R1</td></tr></tbody></table>`, ["R1"]);

    doc.querySelector("td")?.click();

    expect(await reportedDesignators(spy)).toEqual([["R1"]]);
  });
});
