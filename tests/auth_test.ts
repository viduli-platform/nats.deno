/*
 * Copyright 2018-2022 The NATS Authors
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
  assertEquals,
  assertRejects,
  fail,
} from "https://deno.land/std@0.125.0/testing/asserts.ts";
import {
  connect,
  credsAuthenticator,
  ErrorCode,
  jwtAuthenticator,
  nkeyAuthenticator,
  Status,
  StringCodec,
} from "../src/mod.ts";
import { assertErrorCode, NatsServer } from "./helpers/mod.ts";
import { deferred, nkeys } from "../nats-base-client/internal_mod.ts";
import { NKeyAuth } from "../nats-base-client/authenticator.ts";
import { assert } from "../nats-base-client/denobuffer.ts";
import { cleanup, setup } from "./jstest_util.ts";

const conf = {
  authorization: {
    users: [{
      user: "derek",
      password: "foobar",
      permission: {
        subscribe: "bar",
        publish: "foo",
      },
    }],
  },
};

Deno.test("auth - none", async () => {
  const ns = await NatsServer.start(conf);
  try {
    const nc = await connect(
      { port: ns.port },
    );
    await nc.close();
    fail("shouldnt have been able to connect");
  } catch (ex) {
    assertErrorCode(ex, ErrorCode.AuthorizationViolation);
  }
  await ns.stop();
});

Deno.test("auth - bad", async () => {
  const ns = await NatsServer.start(conf);
  try {
    const nc = await connect(
      { port: ns.port, user: "me", pass: "hello" },
    );
    await nc.close();
    fail("shouldnt have been able to connect");
  } catch (ex) {
    assertErrorCode(ex, ErrorCode.AuthorizationViolation);
  }
  await ns.stop();
});

Deno.test("auth - weird chars", async () => {
  const pass = "§12§12§12";
  const ns = await NatsServer.start({
    authorization: {
      username: "admin",
      password: pass,
    },
  });

  const nc = await connect(
    { port: ns.port, user: "admin", pass: pass },
  );
  await nc.flush;
  await nc.close();
  await ns.stop();
});

Deno.test("auth - un/pw", async () => {
  const ns = await NatsServer.start(conf);
  const nc = await connect(
    { port: ns.port, user: "derek", pass: "foobar" },
  );
  await nc.flush();
  await nc.close();
  await ns.stop();
});

Deno.test("auth - sub no permissions keeps connection", async () => {
  const { ns, nc } = await setup({
    authorization: {
      users: [{
        user: "a",
        password: "a",
        permissions: { subscribe: "foo" },
      }],
    },
  }, { user: "a", pass: "a", reconnect: false });

  const errStatus = deferred<Status>();
  const _ = (async () => {
    for await (const s of nc.status()) {
      errStatus.resolve(s);
    }
  })();

  const cbErr = deferred<Error | null>();
  const sub = nc.subscribe("bar", {
    callback: (err, msg) => {
      cbErr.resolve(err);
    },
  });

  const v = await Promise.all([errStatus, cbErr, sub.closed]);
  assertEquals(v[0].data, ErrorCode.PermissionsViolation);
  assertEquals(
    v[1]?.message,
    "'Permissions Violation for Subscription to \"bar\"'",
  );
  assertEquals(nc.isClosed(), false);

  await cleanup(ns, nc);
});

Deno.test("auth - sub iterator no permissions keeps connection", async () => {
  const { ns, nc } = await setup({
    authorization: {
      users: [{
        user: "a",
        password: "a",
        permissions: { subscribe: "foo" },
      }],
    },
  }, { user: "a", pass: "a", reconnect: false });

  const errStatus = deferred<Status>();
  const _ = (async () => {
    for await (const s of nc.status()) {
      errStatus.resolve(s);
    }
  })();

  const iterErr = deferred<Error | null>();
  const sub = nc.subscribe("bar");
  (async () => {
    for await (const m of sub) {
    }
  })().catch((err) => {
    iterErr.resolve(err);
  });

  await nc.flush();

  const v = await Promise.all([errStatus, iterErr, sub.closed]);
  assertEquals(v[0].data, ErrorCode.PermissionsViolation);
  assertEquals(
    v[1]?.message,
    "'Permissions Violation for Subscription to \"bar\"'",
  );
  assertEquals(sub.isClosed(), true);
  assertEquals(nc.isClosed(), false);

  await cleanup(ns, nc);
});

Deno.test("auth - pub permissions keep connection", async () => {
  const { ns, nc } = await setup({
    authorization: {
      users: [{
        user: "a",
        password: "a",
        permissions: { publish: "foo" },
      }],
    },
  }, { user: "a", pass: "a", reconnect: false });

  const errStatus = deferred<Status>();
  const _ = (async () => {
    for await (const s of nc.status()) {
      errStatus.resolve(s);
    }
  })();

  nc.publish("bar");

  const v = await errStatus;
  assertEquals(v.data, ErrorCode.PermissionsViolation);
  assertEquals(nc.isClosed(), false);

  await cleanup(ns, nc);
});

Deno.test("auth - req permissions keep connection", async () => {
  const { ns, nc } = await setup({
    authorization: {
      users: [{
        user: "a",
        password: "a",
        permissions: { publish: "foo" },
      }],
    },
  }, { user: "a", pass: "a", reconnect: false });

  const errStatus = deferred<Status>();
  const _ = (async () => {
    for await (const s of nc.status()) {
      console.log(s);
      errStatus.resolve(s);
    }
  })();

  await assertRejects(
    async () => {
      await nc.request("bar");
    },
    Error,
    ErrorCode.Timeout,
  );

  const v = await errStatus;
  assertEquals(v.data, ErrorCode.PermissionsViolation);
  assertEquals(nc.isClosed(), false);

  await cleanup(ns, nc);
});

Deno.test("auth - user and token is rejected", () => {
  connect({ servers: "127.0.0.1:4222", user: "derek", token: "foobar" })
    .then(async (nc) => {
      await nc.close();
      fail("should not have connected");
    })
    .catch((err) => {
      assertErrorCode(err, ErrorCode.BadAuthentication);
    });
});

Deno.test("auth - token", async () => {
  const ns = await NatsServer.start({ authorization: { token: "foo" } });
  const nc = await connect({ port: ns.port, token: "foo" });
  await nc.flush();
  await nc.close();
  await ns.stop();
});

Deno.test("auth - nkey", async () => {
  const kp = nkeys.createUser();
  const pk = kp.getPublicKey();
  const seed = kp.getSeed();
  const conf = {
    authorization: {
      users: [
        { nkey: pk },
      ],
    },
  };
  const ns = await NatsServer.start(conf);
  const nc = await connect(
    { port: ns.port, authenticator: nkeyAuthenticator(seed) },
  );
  await nc.flush();
  await nc.close();
  await ns.stop();
});

Deno.test("auth - creds", async () => {
  const creds = `-----BEGIN NATS USER JWT-----
    eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJFU1VQS1NSNFhGR0pLN0FHUk5ZRjc0STVQNTZHMkFGWERYQ01CUUdHSklKUEVNUVhMSDJBIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJBQ1pTV0JKNFNZSUxLN1FWREVMTzY0VlgzRUZXQjZDWENQTUVCVUtBMzZNSkpRUlBYR0VFUTJXSiIsInN1YiI6IlVBSDQyVUc2UFY1NTJQNVNXTFdUQlAzSDNTNUJIQVZDTzJJRUtFWFVBTkpYUjc1SjYzUlE1V002IiwidHlwZSI6InVzZXIiLCJuYXRzIjp7InB1YiI6e30sInN1YiI6e319fQ.kCR9Erm9zzux4G6M-V2bp7wKMKgnSNqMBACX05nwePRWQa37aO_yObbhcJWFGYjo1Ix-oepOkoyVLxOJeuD8Bw
  ------END NATS USER JWT------

************************* IMPORTANT *************************
  NKEY Seed printed below can be used sign and prove identity.
    NKEYs are sensitive and should be treated as secrets.

  -----BEGIN USER NKEY SEED-----
    SUAIBDPBAUTWCWBKIO6XHQNINK5FWJW4OHLXC3HQ2KFE4PEJUA44CNHTC4
  ------END USER NKEY SEED------
`;

  const conf = {
    operator:
      "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJhdWQiOiJURVNUUyIsImV4cCI6MTg1OTEyMTI3NSwianRpIjoiWE5MWjZYWVBIVE1ESlFSTlFPSFVPSlFHV0NVN01JNVc1SlhDWk5YQllVS0VRVzY3STI1USIsImlhdCI6MTU0Mzc2MTI3NSwiaXNzIjoiT0NBVDMzTVRWVTJWVU9JTUdOR1VOWEo2NkFIMlJMU0RBRjNNVUJDWUFZNVFNSUw2NU5RTTZYUUciLCJuYW1lIjoiU3luYWRpYSBDb21tdW5pY2F0aW9ucyBJbmMuIiwibmJmIjoxNTQzNzYxMjc1LCJzdWIiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInR5cGUiOiJvcGVyYXRvciIsIm5hdHMiOnsic2lnbmluZ19rZXlzIjpbIk9EU0tSN01ZRlFaNU1NQUo2RlBNRUVUQ1RFM1JJSE9GTFRZUEpSTUFWVk40T0xWMllZQU1IQ0FDIiwiT0RTS0FDU1JCV1A1MzdEWkRSVko2NTdKT0lHT1BPUTZLRzdUNEhONk9LNEY2SUVDR1hEQUhOUDIiLCJPRFNLSTM2TFpCNDRPWTVJVkNSNlA1MkZaSlpZTVlXWlZXTlVEVExFWjVUSzJQTjNPRU1SVEFCUiJdfX0.hyfz6E39BMUh0GLzovFfk3wT4OfualftjdJ_eYkLfPvu5tZubYQ_Pn9oFYGCV_6yKy3KMGhWGUCyCdHaPhalBw",
    resolver: "MEMORY",
    "resolver_preload": {
      ACZSWBJ4SYILK7QVDELO64VX3EFWB6CXCPMEBUKA36MJJQRPXGEEQ2WJ:
        "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJXVFdYVDNCT1JWSFNLQkc2T0pIVVdFQ01QRVdBNldZVEhNRzVEWkJBUUo1TUtGU1dHM1FRIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInN1YiI6IkFDWlNXQko0U1lJTEs3UVZERUxPNjRWWDNFRldCNkNYQ1BNRUJVS0EzNk1KSlFSUFhHRUVRMldKIiwidHlwZSI6ImFjY291bnQiLCJuYXRzIjp7ImxpbWl0cyI6eyJzdWJzIjotMSwiY29ubiI6LTEsImltcG9ydHMiOi0xLCJleHBvcnRzIjotMSwiZGF0YSI6LTEsInBheWxvYWQiOi0xLCJ3aWxkY2FyZHMiOnRydWV9fX0.q-E7bBGTU0uoTmM9Vn7WaEHDzCUrqvPDb9mPMQbry_PNzVAjf0RG9vd15lGxW5lu7CuGVqpj4CYKhNDHluIJAg",
    },
  };
  const ns = await NatsServer.start(conf);
  const nc = await connect(
    {
      port: ns.port,
      authenticator: credsAuthenticator(new TextEncoder().encode(creds)),
    },
  );
  await nc.flush();
  await nc.close();
  await ns.stop();
});

Deno.test("auth - custom", async () => {
  const jwt =
    "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJFU1VQS1NSNFhGR0pLN0FHUk5ZRjc0STVQNTZHMkFGWERYQ01CUUdHSklKUEVNUVhMSDJBIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJBQ1pTV0JKNFNZSUxLN1FWREVMTzY0VlgzRUZXQjZDWENQTUVCVUtBMzZNSkpRUlBYR0VFUTJXSiIsInN1YiI6IlVBSDQyVUc2UFY1NTJQNVNXTFdUQlAzSDNTNUJIQVZDTzJJRUtFWFVBTkpYUjc1SjYzUlE1V002IiwidHlwZSI6InVzZXIiLCJuYXRzIjp7InB1YiI6e30sInN1YiI6e319fQ.kCR9Erm9zzux4G6M-V2bp7wKMKgnSNqMBACX05nwePRWQa37aO_yObbhcJWFGYjo1Ix-oepOkoyVLxOJeuD8Bw";
  const useed = "SUAIBDPBAUTWCWBKIO6XHQNINK5FWJW4OHLXC3HQ2KFE4PEJUA44CNHTC4";

  const conf = {
    operator:
      "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJhdWQiOiJURVNUUyIsImV4cCI6MTg1OTEyMTI3NSwianRpIjoiWE5MWjZYWVBIVE1ESlFSTlFPSFVPSlFHV0NVN01JNVc1SlhDWk5YQllVS0VRVzY3STI1USIsImlhdCI6MTU0Mzc2MTI3NSwiaXNzIjoiT0NBVDMzTVRWVTJWVU9JTUdOR1VOWEo2NkFIMlJMU0RBRjNNVUJDWUFZNVFNSUw2NU5RTTZYUUciLCJuYW1lIjoiU3luYWRpYSBDb21tdW5pY2F0aW9ucyBJbmMuIiwibmJmIjoxNTQzNzYxMjc1LCJzdWIiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInR5cGUiOiJvcGVyYXRvciIsIm5hdHMiOnsic2lnbmluZ19rZXlzIjpbIk9EU0tSN01ZRlFaNU1NQUo2RlBNRUVUQ1RFM1JJSE9GTFRZUEpSTUFWVk40T0xWMllZQU1IQ0FDIiwiT0RTS0FDU1JCV1A1MzdEWkRSVko2NTdKT0lHT1BPUTZLRzdUNEhONk9LNEY2SUVDR1hEQUhOUDIiLCJPRFNLSTM2TFpCNDRPWTVJVkNSNlA1MkZaSlpZTVlXWlZXTlVEVExFWjVUSzJQTjNPRU1SVEFCUiJdfX0.hyfz6E39BMUh0GLzovFfk3wT4OfualftjdJ_eYkLfPvu5tZubYQ_Pn9oFYGCV_6yKy3KMGhWGUCyCdHaPhalBw",
    resolver: "MEMORY",
    "resolver_preload": {
      ACZSWBJ4SYILK7QVDELO64VX3EFWB6CXCPMEBUKA36MJJQRPXGEEQ2WJ:
        "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJXVFdYVDNCT1JWSFNLQkc2T0pIVVdFQ01QRVdBNldZVEhNRzVEWkJBUUo1TUtGU1dHM1FRIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInN1YiI6IkFDWlNXQko0U1lJTEs3UVZERUxPNjRWWDNFRldCNkNYQ1BNRUJVS0EzNk1KSlFSUFhHRUVRMldKIiwidHlwZSI6ImFjY291bnQiLCJuYXRzIjp7ImxpbWl0cyI6eyJzdWJzIjotMSwiY29ubiI6LTEsImltcG9ydHMiOi0xLCJleHBvcnRzIjotMSwiZGF0YSI6LTEsInBheWxvYWQiOi0xLCJ3aWxkY2FyZHMiOnRydWV9fX0.q-E7bBGTU0uoTmM9Vn7WaEHDzCUrqvPDb9mPMQbry_PNzVAjf0RG9vd15lGxW5lu7CuGVqpj4CYKhNDHluIJAg",
    },
  };
  const ns = await NatsServer.start(conf);
  const authenticator = (nonce?: string) => {
    const seed = nkeys.fromSeed(new TextEncoder().encode(useed));
    const nkey = seed.getPublicKey();
    const hash = seed.sign(new TextEncoder().encode(nonce));
    const sig = nkeys.encode(hash);

    return { nkey, sig, jwt };
  };
  const nc = await connect(
    {
      port: ns.port,
      authenticator: authenticator,
    },
  );
  await nc.flush();
  await nc.close();
  await ns.stop();
});

Deno.test("auth - jwt", async () => {
  const jwt =
    "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJFU1VQS1NSNFhGR0pLN0FHUk5ZRjc0STVQNTZHMkFGWERYQ01CUUdHSklKUEVNUVhMSDJBIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJBQ1pTV0JKNFNZSUxLN1FWREVMTzY0VlgzRUZXQjZDWENQTUVCVUtBMzZNSkpRUlBYR0VFUTJXSiIsInN1YiI6IlVBSDQyVUc2UFY1NTJQNVNXTFdUQlAzSDNTNUJIQVZDTzJJRUtFWFVBTkpYUjc1SjYzUlE1V002IiwidHlwZSI6InVzZXIiLCJuYXRzIjp7InB1YiI6e30sInN1YiI6e319fQ.kCR9Erm9zzux4G6M-V2bp7wKMKgnSNqMBACX05nwePRWQa37aO_yObbhcJWFGYjo1Ix-oepOkoyVLxOJeuD8Bw";
  const useed = "SUAIBDPBAUTWCWBKIO6XHQNINK5FWJW4OHLXC3HQ2KFE4PEJUA44CNHTC4";

  const conf = {
    operator:
      "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJhdWQiOiJURVNUUyIsImV4cCI6MTg1OTEyMTI3NSwianRpIjoiWE5MWjZYWVBIVE1ESlFSTlFPSFVPSlFHV0NVN01JNVc1SlhDWk5YQllVS0VRVzY3STI1USIsImlhdCI6MTU0Mzc2MTI3NSwiaXNzIjoiT0NBVDMzTVRWVTJWVU9JTUdOR1VOWEo2NkFIMlJMU0RBRjNNVUJDWUFZNVFNSUw2NU5RTTZYUUciLCJuYW1lIjoiU3luYWRpYSBDb21tdW5pY2F0aW9ucyBJbmMuIiwibmJmIjoxNTQzNzYxMjc1LCJzdWIiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInR5cGUiOiJvcGVyYXRvciIsIm5hdHMiOnsic2lnbmluZ19rZXlzIjpbIk9EU0tSN01ZRlFaNU1NQUo2RlBNRUVUQ1RFM1JJSE9GTFRZUEpSTUFWVk40T0xWMllZQU1IQ0FDIiwiT0RTS0FDU1JCV1A1MzdEWkRSVko2NTdKT0lHT1BPUTZLRzdUNEhONk9LNEY2SUVDR1hEQUhOUDIiLCJPRFNLSTM2TFpCNDRPWTVJVkNSNlA1MkZaSlpZTVlXWlZXTlVEVExFWjVUSzJQTjNPRU1SVEFCUiJdfX0.hyfz6E39BMUh0GLzovFfk3wT4OfualftjdJ_eYkLfPvu5tZubYQ_Pn9oFYGCV_6yKy3KMGhWGUCyCdHaPhalBw",
    resolver: "MEMORY",
    "resolver_preload": {
      ACZSWBJ4SYILK7QVDELO64VX3EFWB6CXCPMEBUKA36MJJQRPXGEEQ2WJ:
        "eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJXVFdYVDNCT1JWSFNLQkc2T0pIVVdFQ01QRVdBNldZVEhNRzVEWkJBUUo1TUtGU1dHM1FRIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJPQ0FUMzNNVFZVMlZVT0lNR05HVU5YSjY2QUgyUkxTREFGM01VQkNZQVk1UU1JTDY1TlFNNlhRRyIsInN1YiI6IkFDWlNXQko0U1lJTEs3UVZERUxPNjRWWDNFRldCNkNYQ1BNRUJVS0EzNk1KSlFSUFhHRUVRMldKIiwidHlwZSI6ImFjY291bnQiLCJuYXRzIjp7ImxpbWl0cyI6eyJzdWJzIjotMSwiY29ubiI6LTEsImltcG9ydHMiOi0xLCJleHBvcnRzIjotMSwiZGF0YSI6LTEsInBheWxvYWQiOi0xLCJ3aWxkY2FyZHMiOnRydWV9fX0.q-E7bBGTU0uoTmM9Vn7WaEHDzCUrqvPDb9mPMQbry_PNzVAjf0RG9vd15lGxW5lu7CuGVqpj4CYKhNDHluIJAg",
    },
  };
  const ns = await NatsServer.start(conf);
  let nc = await connect(
    {
      port: ns.port,
      authenticator: jwtAuthenticator(jwt, new TextEncoder().encode(useed)),
    },
  );
  await nc.flush();
  await nc.close();

  nc = await connect(
    {
      port: ns.port,
      authenticator: jwtAuthenticator((): string => {
        return jwt;
      }, new TextEncoder().encode(useed)),
    },
  );
  await nc.flush();
  await nc.close();

  await ns.stop();
});

Deno.test("auth - custom error", async () => {
  const ns = await NatsServer.start(conf);
  const authenticator = () => {
    throw new Error("user code exploded");
  };
  await connect(
    {
      port: ns.port,
      maxReconnectAttempts: 1,
      authenticator: authenticator,
    },
  ).then(() => {
    fail("shouldn't have connected");
  }).catch((err) => {
    assertErrorCode(err, ErrorCode.BadAuthentication);
  });
  await ns.stop();
});

Deno.test("basics - bad auth", async () => {
  try {
    await connect(
      {
        servers: "connect.ngs.global",
        waitOnFirstConnect: true,
        user: "me",
        pass: "you",
      },
    );
  } catch (err) {
    assertErrorCode(err, ErrorCode.AuthorizationViolation);
  }
});

Deno.test("auth - nkey authentication", async () => {
  const ukp = nkeys.createUser();
  const conf = {
    authorization: {
      users: [{
        nkey: ukp.getPublicKey(),
      }],
    },
  };

  // static
  const ns = await NatsServer.start(conf);
  let nc = await connect({
    port: ns.port,
    authenticator: nkeyAuthenticator(ukp.getSeed()),
  });
  await nc.flush();
  await nc.close();

  // from function
  nc = await connect({
    port: ns.port,
    authenticator: nkeyAuthenticator((): Uint8Array => {
      return ukp.getSeed();
    }),
  });
  await nc.flush();
  await nc.close();
  await ns.stop();
});

Deno.test("auth - creds authenticator validation", () => {
  const jwt =
    `eyJ0eXAiOiJqd3QiLCJhbGciOiJlZDI1NTE5In0.eyJqdGkiOiJFU1VQS1NSNFhGR0pLN0FHUk5ZRjc0STVQNTZHMkFGWERYQ01CUUdHSklKUEVNUVhMSDJBIiwiaWF0IjoxNTQ0MjE3NzU3LCJpc3MiOiJBQ1pTV0JKNFNZSUxLN1FWREVMTzY0VlgzRUZXQjZDWENQTUVCVUtBMzZNSkpRUlBYR0VFUTJXSiIsInN1YiI6IlVBSDQyVUc2UFY1NTJQNVNXTFdUQlAzSDNTNUJIQVZDTzJJRUtFWFVBTkpYUjc1SjYzUlE1V002IiwidHlwZSI6InVzZXIiLCJuYXRzIjp7InB1YiI6e30sInN1YiI6e319fQ.kCR9Erm9zzux4G6M-V2bp7wKMKgnSNqMBACX05nwePRWQa37aO_yObbhcJWFGYjo1Ix-oepOkoyVLxOJeuD8Bw`;
  const ukp = nkeys.createUser();
  const upk = ukp.getPublicKey();
  const sc = StringCodec();
  const seed = sc.decode(ukp.getSeed());

  function creds(ajwt = "", aseed = ""): string {
    return `-----BEGIN NATS USER JWT-----
    ${ajwt}
  ------END NATS USER JWT------

************************* IMPORTANT *************************
  NKEY Seed printed below can be used sign and prove identity.
    NKEYs are sensitive and should be treated as secrets.

  -----BEGIN USER NKEY SEED-----
    ${aseed}
  ------END USER NKEY SEED------
 `;
  }

  type test = [string, string, boolean, string];
  const tests: test[] = [];
  tests.push(["", "", false, "no jwt, no seed"]);
  tests.push([jwt, "", false, "no seed"]);
  tests.push(["", seed, false, "no jwt"]);
  tests.push([jwt, seed, true, "jwt and seed"]);

  tests.forEach((v) => {
    const d = sc.encode(creds(v[0], v[1]));
    try {
      const auth = credsAuthenticator(d);
      if (!v[2]) {
        fail(`should have failed: ${v[3]}`);
      }
      const { nkey, sig } = auth("helloworld") as unknown as NKeyAuth;
      assertEquals(nkey, upk);
      assert(sig.length > 0);
    } catch (_err) {
      if (v[2]) {
        fail(`should have passed: ${v[3]}`);
      }
    }
  });
});
