// Compile-time stand-in for the client's scene repository interface (Whirled's SceneRepository,
// obfuscated to this name), so CapturingRepository can implement it with a JDK older than the
// client's class files. Never packaged: the client's own interface is used at run time.
package com.threerings.whirled.a.a;

public interface a {
  com.threerings.whirled.data.SceneModel dp(int sceneId);
  void a(com.threerings.whirled.data.SceneModel model);
  void dq(int sceneId);
}
