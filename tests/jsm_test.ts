/*
 * Copyright 2021 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
  fail,
} from "https://deno.land/std@0.125.0/testing/asserts.ts";

import {
  AckPolicy,
  AdvisoryKind,
  deferred,
  Empty,
  ErrorCode,
  headers,
  JSONCodec,
  nanos,
  NatsError,
  nuid,
  StreamConfig,
  StreamInfo,
  StringCodec,
} from "../nats-base-client/internal_mod.ts";
import {
  cleanup,
  initStream,
  jetstreamExportServerConf,
  jetstreamServerConf,
  setup,
} from "./jstest_util.ts";
import { connect } from "../src/mod.ts";
import { assertThrowsAsyncErrorCode, notCompatible } from "./helpers/mod.ts";
import { validateName } from "../nats-base-client/jsutil.ts";

const StreamNameRequired = "stream name required";
const ConsumerNameRequired = "durable name required";

Deno.test("jsm - jetstream not enabled", async () => {
  // start a regular server - no js conf
  const { ns, nc } = await setup();
  await assertThrowsAsyncErrorCode(async () => {
    await nc.jetstreamManager();
  }, ErrorCode.JetStreamNotEnabled);
  await cleanup(ns, nc);
});

Deno.test("jsm - account info", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const ai = await jsm.getAccountInfo();
  assert(ai.limits.max_memory === -1 || ai.limits.max_memory > 0);
  await cleanup(ns, nc);
});

Deno.test("jsm - account not enabled", async () => {
  const conf = {
    "no_auth_user": "b",
    accounts: {
      A: {
        jetstream: "enabled",
        users: [{ user: "a", password: "a" }],
      },
      B: {
        users: [{ user: "b" }],
      },
    },
  };
  const { ns, nc } = await setup(jetstreamServerConf(conf, true));
  await assertThrowsAsyncErrorCode(async () => {
    await nc.jetstreamManager();
  }, ErrorCode.JetStreamNotEnabled);

  const a = await connect(
    { port: ns.port, user: "a", pass: "a" },
  );
  await a.jetstreamManager();
  await a.close();
  await cleanup(ns, nc);
});

Deno.test("jsm - empty stream config fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.streams.add({} as StreamConfig);
    },
    Error,
    StreamNameRequired,
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - empty stream config update fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const name = nuid.next();
  let ci = await jsm.streams.add({ name: name, subjects: [`${name}.>`] });
  assertEquals(ci!.config!.subjects!.length, 1);

  await assertRejects(
    async () => {
      await jsm.streams.update("", {} as StreamConfig);
    },
    Error,
    StreamNameRequired,
    undefined,
  );
  ci!.config!.subjects!.push("foo");
  ci = await jsm.streams.update(name, ci.config);
  assertEquals(ci!.config!.subjects!.length, 2);
  await cleanup(ns, nc);
});

Deno.test("jsm - update stream name is internally added", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const name = nuid.next();
  let ci = await jsm.streams.add({
    name: name,
    subjects: [`${name}.>`],
  });
  assertEquals(ci!.config!.subjects!.length, 1);

  const si = await jsm.streams.update(name, { subjects: [`${name}.>`, "foo"] });
  assertEquals(si!.config!.subjects!.length, 2);
  await cleanup(ns, nc);
});

Deno.test("jsm - delete empty stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.streams.delete("");
    },
    Error,
    StreamNameRequired,
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - info empty stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.streams.info("");
    },
    Error,
    StreamNameRequired,
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - info msg not found stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const name = nuid.next();
  await assertRejects(
    async () => {
      await jsm.streams.info(name);
    },
    Error,
    "stream not found",
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - delete msg empty stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.streams.deleteMessage("", 1);
    },
    Error,
    StreamNameRequired,
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - delete msg not found stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const name = nuid.next();
  await assertRejects(
    async () => {
      await jsm.streams.deleteMessage(name, 1);
    },
    Error,
    "stream not found",
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - no stream lister is empty", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const streams = await jsm.streams.list().next();
  assertEquals(streams.length, 0);
  await cleanup(ns, nc);
});

Deno.test("jsm - lister after empty, empty", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const lister = jsm.streams.list();
  let streams = await lister.next();
  assertEquals(streams.length, 0);
  streams = await lister.next();
  assertEquals(streams.length, 0);
  await cleanup(ns, nc);
});

Deno.test("jsm - add stream", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const name = nuid.next();
  let si = await jsm.streams.add({ name });
  assertEquals(si.config.name, name);

  const fn = (i: StreamInfo): boolean => {
    assertEquals(i.config, si.config);
    assertEquals(i.state, si.state);
    assertEquals(i.created, si.created);
    return true;
  };

  fn(await jsm.streams.info(name));
  let lister = await jsm.streams.list().next();
  fn(lister[0]);

  // add some data
  nc.publish(name, Empty);
  si = await jsm.streams.info(name);
  lister = await jsm.streams.list().next();
  fn(lister[0]);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge not found stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const name = nuid.next();
  await assertRejects(
    async () => {
      await jsm.streams.purge(name);
    },
    Error,
    "stream not found",
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - purge empty stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.streams.purge("");
    },
    Error,
    StreamNameRequired,
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - stream purge", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream, subj } = await initStream(nc);
  const jsm = await nc.jetstreamManager();

  nc.publish(subj, Empty);

  let si = await jsm.streams.info(stream);
  assertEquals(si.state.messages, 1);

  await jsm.streams.purge(stream);
  si = await jsm.streams.info(stream);
  assertEquals(si.state.messages, 0);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge by sequence", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const stream = nuid.next();
  await jsm.streams.add(
    { name: stream, subjects: [`${stream}.*`] },
  );

  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);

  const pi = await jsm.streams.purge(stream, { seq: 4 });
  assertEquals(pi.purged, 3);
  const si = await jsm.streams.info(stream);
  assertEquals(si.state.first_seq, 4);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge by filtered sequence", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const stream = nuid.next();
  await jsm.streams.add(
    { name: stream, subjects: [`${stream}.*`] },
  );

  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);

  const pi = await jsm.streams.purge(stream, { seq: 4, filter: `${stream}.b` });
  assertEquals(pi.purged, 1);
  const si = await jsm.streams.info(stream);
  assertEquals(si.state.first_seq, 1);
  assertEquals(si.state.messages, 8);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge by subject", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const stream = nuid.next();
  await jsm.streams.add(
    { name: stream, subjects: [`${stream}.*`] },
  );

  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);

  const pi = await jsm.streams.purge(stream, { filter: `${stream}.b` });
  assertEquals(pi.purged, 3);
  const si = await jsm.streams.info(stream);
  assertEquals(si.state.first_seq, 1);
  assertEquals(si.state.messages, 6);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge by subject", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const stream = nuid.next();
  await jsm.streams.add(
    { name: stream, subjects: [`${stream}.*`] },
  );

  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);

  const pi = await jsm.streams.purge(stream, { filter: `${stream}.b` });
  assertEquals(pi.purged, 3);
  const si = await jsm.streams.info(stream);
  assertEquals(si.state.first_seq, 1);
  assertEquals(si.state.messages, 6);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge keep", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const stream = nuid.next();
  await jsm.streams.add(
    { name: stream, subjects: [`${stream}.*`] },
  );

  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);

  const pi = await jsm.streams.purge(stream, { keep: 1 });
  assertEquals(pi.purged, 8);
  const si = await jsm.streams.info(stream);
  assertEquals(si.state.first_seq, 9);
  assertEquals(si.state.messages, 1);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge filtered keep", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const stream = nuid.next();
  await jsm.streams.add(
    { name: stream, subjects: [`${stream}.*`] },
  );

  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);
  nc.publish(`${stream}.a`);
  nc.publish(`${stream}.b`);
  nc.publish(`${stream}.c`);

  let pi = await jsm.streams.purge(stream, { keep: 1, filter: `${stream}.a` });
  assertEquals(pi.purged, 2);
  pi = await jsm.streams.purge(stream, { keep: 1, filter: `${stream}.b` });
  assertEquals(pi.purged, 2);
  pi = await jsm.streams.purge(stream, { keep: 1, filter: `${stream}.c` });
  assertEquals(pi.purged, 2);

  const si = await jsm.streams.info(stream);
  assertEquals(si.state.first_seq, 7);
  assertEquals(si.state.messages, 3);

  await cleanup(ns, nc);
});

Deno.test("jsm - purge seq and keep fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.streams.purge("a", { keep: 10, seq: 5 });
    },
    undefined,
    "",
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - stream delete", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream, subj } = await initStream(nc);
  const jsm = await nc.jetstreamManager();

  nc.publish(subj, Empty);
  await jsm.streams.delete(stream);
  await assertRejects(
    async () => {
      await jsm.streams.info(stream);
    },
    Error,
    "stream not found",
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - stream delete message", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream, subj } = await initStream(nc);
  const jsm = await nc.jetstreamManager();

  nc.publish(subj, Empty);

  let si = await jsm.streams.info(stream);
  assertEquals(si.state.messages, 1);
  assertEquals(si.state.first_seq, 1);
  assertEquals(si.state.last_seq, 1);

  assert(await jsm.streams.deleteMessage(stream, 1));
  si = await jsm.streams.info(stream);
  assertEquals(si.state.messages, 0);
  assertEquals(si.state.first_seq, 2);
  assertEquals(si.state.last_seq, 1);

  await cleanup(ns, nc);
});

Deno.test("jsm - stream delete info", async () => {
  const { ns, nc } = await setup(jetstreamServerConf());

  const { stream, subj } = await initStream(nc);
  const jsm = await nc.jetstreamManager();

  const js = nc.jetstream();
  await js.publish(subj);
  await js.publish(subj);
  await js.publish(subj);
  await jsm.streams.deleteMessage(stream, 2);

  const si = await jsm.streams.info(stream, { deleted_details: true });
  assertEquals(si.state.num_deleted, 1);
  assertEquals(si.state.deleted, [2]);

  await cleanup(ns, nc);
});

Deno.test("jsm - consumer info on empty stream name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.consumers.info("", "");
    },
    Error,
    StreamNameRequired,
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - consumer info on empty consumer name fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.consumers.info("foo", "");
    },
    Error,
    ConsumerNameRequired,
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - consumer info on not found stream fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.consumers.info("foo", "dur");
    },
    Error,
    "stream not found",
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - consumer info on not found consumer", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream } = await initStream(nc);
  const jsm = await nc.jetstreamManager();
  await assertRejects(
    async () => {
      await jsm.consumers.info(stream, "dur");
    },
    Error,
    "consumer not found",
    undefined,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - consumer info", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream } = await initStream(nc);
  const jsm = await nc.jetstreamManager();
  await jsm.consumers.add(
    stream,
    { durable_name: "dur", ack_policy: AckPolicy.Explicit },
  );
  const ci = await jsm.consumers.info(stream, "dur");
  assertEquals(ci.name, "dur");
  assertEquals(ci.config.durable_name, "dur");
  assertEquals(ci.config.ack_policy, "explicit");
  await cleanup(ns, nc);
});

Deno.test("jsm - no consumer lister with empty stream fails", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  assertThrows(
    () => {
      jsm.consumers.list("");
    },
    Error,
    StreamNameRequired,
  );
  await cleanup(ns, nc);
});

Deno.test("jsm - no consumer lister with no consumers empty", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream } = await initStream(nc);
  const jsm = await nc.jetstreamManager();
  const consumers = await jsm.consumers.list(stream).next();
  assertEquals(consumers.length, 0);
  await cleanup(ns, nc);
});

Deno.test("jsm - lister", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream } = await initStream(nc);
  const jsm = await nc.jetstreamManager();
  await jsm.consumers.add(
    stream,
    { durable_name: "dur", ack_policy: AckPolicy.Explicit },
  );
  let consumers = await jsm.consumers.list(stream).next();
  assertEquals(consumers.length, 1);
  assertEquals(consumers[0].config.durable_name, "dur");

  await jsm.consumers.delete(stream, "dur");
  consumers = await jsm.consumers.list(stream).next();
  assertEquals(consumers.length, 0);

  await cleanup(ns, nc);
});

Deno.test("jsm - update stream", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream } = await initStream(nc);
  const jsm = await nc.jetstreamManager();

  let si = await jsm.streams.info(stream);
  assertEquals(si.config!.subjects!.length, 1);

  si.config!.subjects!.push("foo");
  si = await jsm.streams.update(stream, si.config);
  assertEquals(si.config!.subjects!.length, 2);
  await cleanup(ns, nc);
});

Deno.test("jsm - get message", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream, subj } = await initStream(nc);

  const jc = JSONCodec();
  const h = headers();
  h.set("xxx", "a");
  nc.publish(subj, jc.encode(1), { headers: h });
  nc.publish(subj, jc.encode(2));

  const jsm = await nc.jetstreamManager();
  let sm = await jsm.streams.getMessage(stream, { seq: 1 });
  assertEquals(sm.subject, subj);
  assertEquals(sm.seq, 1);
  assertEquals(jc.decode(sm.data), 1);

  sm = await jsm.streams.getMessage(stream, { seq: 2 });
  assertEquals(sm.subject, subj);
  assertEquals(sm.seq, 2);
  assertEquals(jc.decode(sm.data), 2);

  await assertRejects(
    async () => {
      await jsm.streams.getMessage(stream, { seq: 3 });
    },
    (err: Error) => {
      if (
        err.message !== "stream store eof" && err.message !== "no message found"
      ) {
        fail(`unexpected error message ${err.message}`);
      }
    },
  );

  await cleanup(ns, nc);
});

Deno.test("jsm - get message payload", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const { stream, subj } = await initStream(nc);
  const js = nc.jetstream();
  const sc = StringCodec();
  await js.publish(subj, Empty, { msgID: "empty" });
  await js.publish(subj, sc.encode(""), { msgID: "empty2" });

  const jsm = await nc.jetstreamManager();
  let sm = await jsm.streams.getMessage(stream, { seq: 1 });
  assertEquals(sm.subject, subj);
  assertEquals(sm.seq, 1);
  assertEquals(sm.data, Empty);

  sm = await jsm.streams.getMessage(stream, { seq: 2 });
  assertEquals(sm.subject, subj);
  assertEquals(sm.seq, 2);
  assertEquals(sm.data, Empty);
  assertEquals(sc.decode(sm.data), "");

  await cleanup(ns, nc);
});

Deno.test("jsm - advisories", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  const jsm = await nc.jetstreamManager();
  const iter = jsm.advisories();
  const streamAction = deferred();
  (async () => {
    for await (const a of iter) {
      if (a.kind === AdvisoryKind.StreamAction) {
        streamAction.resolve();
      }
    }
  })().then();
  await initStream(nc);
  await streamAction;
  await cleanup(ns, nc);
});

Deno.test("jsm - validate name", () => {
  type t = [string, boolean];
  const tests: t[] = [
    ["", false],
    [".", false],
    ["*", false],
    [">", false],
    ["hello.", false],
    ["hello.*", false],
    ["hello.>", false],
    ["one.two", false],
    ["one*two", false],
    ["one>two", false],
    ["stream", true],
  ];

  tests.forEach((v, idx) => {
    try {
      validateName(`${idx}`, v[0]);
      if (!v[1]) {
        fail(`${v[0]} should have been rejected`);
      }
    } catch (_err) {
      if (v[1]) {
        fail(`${v[0]} should have been valid`);
      }
    }
  });
});

Deno.test("jsm - cross account streams", async () => {
  const { ns, nc } = await setup(
    jetstreamExportServerConf(),
    {
      user: "a",
      pass: "s3cret",
    },
  );

  const sawIPA = deferred();
  nc.subscribe("IPA.>", {
    callback: () => {
      sawIPA.resolve();
    },
    max: 1,
  });

  const jsm = await nc.jetstreamManager({ apiPrefix: "IPA" });
  await sawIPA;

  // no streams
  let streams = await jsm.streams.list().next();
  assertEquals(streams.length, 0);

  // add a stream
  const stream = nuid.next();
  const subj = `${stream}.A`;
  await jsm.streams.add({ name: stream, subjects: [subj] });

  // list the stream
  streams = await jsm.streams.list().next();
  assertEquals(streams.length, 1);

  // cannot publish to the stream from the client account
  // publish from the js account
  const admin = await connect({ port: ns.port, user: "js", pass: "js" });
  admin.publish(subj);
  admin.publish(subj);
  await admin.flush();

  // info
  let si = await jsm.streams.info(stream);
  assertEquals(si.state.messages, 2);

  // get message
  const sm = await jsm.streams.getMessage(stream, { seq: 1 });
  assertEquals(sm.seq, 1);

  // delete message
  let ok = await jsm.streams.deleteMessage(stream, 1);
  assertEquals(ok, true);
  si = await jsm.streams.info(stream);
  assertEquals(si.state.messages, 1);

  // purge
  const pr = await jsm.streams.purge(stream);
  assertEquals(pr.success, true);
  assertEquals(pr.purged, 1);
  si = await jsm.streams.info(stream);
  assertEquals(si.state.messages, 0);

  // update
  const config = streams[0].config as StreamConfig;
  config.subjects!.push(`${stream}.B`);
  si = await jsm.streams.update(config.name, config);
  assertEquals(si.config.subjects!.length, 2);

  // find
  const sn = await jsm.streams.find(`${stream}.B`);
  assertEquals(sn, stream);

  // delete
  ok = await jsm.streams.delete(stream);
  assertEquals(ok, true);

  streams = await jsm.streams.list().next();
  assertEquals(streams.length, 0);

  await cleanup(ns, nc, admin);
});

Deno.test("jsm - cross account consumers", async () => {
  const { ns, nc } = await setup(
    jetstreamExportServerConf(),
    {
      user: "a",
      pass: "s3cret",
    },
  );

  const sawIPA = deferred();
  nc.subscribe("IPA.>", {
    callback: () => {
      sawIPA.resolve();
    },
    max: 1,
  });

  const jsm = await nc.jetstreamManager({ apiPrefix: "IPA" });
  await sawIPA;

  // add a stream
  const stream = nuid.next();
  const subj = `${stream}.A`;
  await jsm.streams.add({ name: stream, subjects: [subj] });

  let consumers = await jsm.consumers.list(stream).next();
  assertEquals(consumers.length, 0);

  await jsm.consumers.add(stream, {
    durable_name: "me",
    ack_policy: AckPolicy.Explicit,
  });

  // cannot publish to the stream from the client account
  // publish from the js account
  const admin = await connect({ port: ns.port, user: "js", pass: "js" });
  admin.publish(subj);
  admin.publish(subj);
  await admin.flush();

  consumers = await jsm.consumers.list(stream).next();
  assertEquals(consumers.length, 1);
  assertEquals(consumers[0].name, "me");
  assertEquals(consumers[0].config.durable_name, "me");
  assertEquals(consumers[0].num_pending, 2);

  const ci = await jsm.consumers.info(stream, "me");
  assertEquals(ci.name, "me");
  assertEquals(ci.config.durable_name, "me");
  assertEquals(ci.num_pending, 2);

  const ok = await jsm.consumers.delete(stream, "me");
  assertEquals(ok, true);

  await assertRejects(
    async () => {
      await jsm.consumers.info(stream, "me");
    },
    Error,
    "consumer not found",
    undefined,
  );

  await cleanup(ns, nc, admin);
});

Deno.test("jsm - jetstream error info", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  let jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.add({
      name: "a",
      num_replicas: 3,
      subjects: ["a.>"],
    });
    fail("should have failed");
  } catch (err) {
    const ne = err as NatsError;
    assert(ne.isJetStreamError());
    const jerr = ne.jsError();
    assert(jerr);
    assertEquals(jerr.code, 500);
    assertEquals(jerr.err_code, 10074);
    assertEquals(
      jerr.description,
      "replicas > 1 not supported in non-clustered mode",
    );
  }
  await cleanup(ns, nc);
});

Deno.test("jsm - update consumer", async () => {
  const { ns, nc } = await setup(jetstreamServerConf({}, true));
  if (await notCompatible(ns, nc, "2.6.4")) {
    return;
  }
  const { stream } = await initStream(nc);

  const jsm = await nc.jetstreamManager();
  await jsm.consumers.add(stream, {
    durable_name: "dur",
    ack_policy: AckPolicy.Explicit,
    ack_wait: nanos(2000),
    max_ack_pending: 500,
    headers_only: false,
    max_deliver: 100,
  });

  // update is simply syntatic sugar for add providing a type to
  // help the IDE show editable properties - server will still
  // reject options it doesn't deem editable
  const ci = await jsm.consumers.update(stream, "dur", {
    ack_wait: nanos(3000),
    max_ack_pending: 5,
    headers_only: true,
    max_deliver: 2,
  });

  assertEquals(ci.config.ack_wait, nanos(3000));
  assertEquals(ci.config.max_ack_pending, 5);
  assertEquals(ci.config.headers_only, true);
  assertEquals(ci.config.max_deliver, 2);

  await cleanup(ns, nc);
});
