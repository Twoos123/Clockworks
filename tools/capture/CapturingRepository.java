// The client's scene repository, wrapped: every call goes straight through, and each scene model
// it loads or stores is also handed to SceneCapture. A real class rather than a reflective proxy,
// because the client's repository throws NoSuchSceneException (a checked exception its obfuscated
// interface doesn't declare) to ask the server for a level, and a proxy would wrap that and break
// level loading. Compiled against tools/capture/stubs.

import com.threerings.whirled.a.a.a;
import com.threerings.whirled.data.SceneModel;

public class CapturingRepository implements a {
  private final a inner;

  public CapturingRepository(Object inner) { this.inner = (a) inner; }

  public SceneModel dp(int sceneId) {
    SceneModel model = inner.dp(sceneId);
    SceneCapture.capture(model);
    return model;
  }

  public void a(SceneModel model) {
    inner.a(model);
    SceneCapture.capture(model);
  }

  public void dq(int sceneId) { inner.dq(sceneId); }
}
