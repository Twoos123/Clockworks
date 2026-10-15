// Starts the player's own Spiral Knights client and keeps a copy of every level the servers send
// it. The client already saves fixed scenes (towns, buildings) to its scenes/ folder, but it never
// writes instanced floors: mission and Arcade floors have scene ids of 2^30 and up, and its
// scene cache skips them. This launcher wraps that cache: each scene the client loads or stores
// is written once more, unchanged, to the capture folder (-Dcapture.dir), where clyde-web's
// archive sync picks it up (server/install.ts). Nothing the client sends or receives is altered,
// and the client runs exactly as its own launcher would start it.
//
// Compiled with no compile-time reference to the client (everything is found by reflection), so
// any JDK 21+ builds it: tools/capture/build.cmd. Run with tools/capture/play.cmd.

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Set;

public class SceneCapture {
  static final String APP = "com.threerings.projectx.client.ProjectXApp";
  static final String REPOSITORY = "com.threerings.whirled.client.persist.SceneRepository";
  static final String REPOSITORY_OBF = "com.threerings.whirled.a.a.a";
  static final int INSTANCE_IDS = 1073741823;

  static File dir;
  static final Set<String> written = new HashSet<>();

  public static void main(String[] args) throws Throwable {
    dir = new File(System.getProperty("capture.dir",
      System.getenv("LOCALAPPDATA") + File.separator + "clyde-web" + File.separator + "captured"));
    dir.mkdirs();
    log("capturing levels to " + dir);

    Class<?> app = Class.forName(APP);
    Method main = app.getMethod("main", String[].class);
    // ProjectXApp.main builds the app and calls startup(), which runs the game loop on this thread;
    // the scene director (and its repository) is made in the constructor, so the constructor is
    // intercepted by building the app the same way main does, wrapping, then starting it.
    Object instance = construct(app, args);
    if (instance == null) { log("could not build the app; starting it unwrapped"); main.invoke(null, (Object) args); return; }
    wrapRepository(instance);
    app.getMethod("startup").invoke(instance);
  }

  /** Builds the app as ProjectXApp.main does (its system properties, log file and arguments). */
  static Object construct(Class<?> app, String[] args) {
    try {
      System.setProperty("com.threerings.io.enumPolicy", "ORDINAL");
      // as main: a large container limit when the client's flag asks for it, then the log file
      if ((Boolean) Class.forName("com.threerings.projectx.util.a").getMethod("aaQ").invoke(null))
        System.setProperty("com.threerings.io.maxContainerSize", String.valueOf(Integer.MAX_VALUE));
      Class.forName("com.threerings.util.ad").getMethod("gB", String.class).invoke(null, "projectx.log");
      String connect = null;
      java.util.List<String> rest = new java.util.ArrayList<>();
      for (String a : args) { if (connect == null && a.startsWith("+connect=")) connect = a; else rest.add(a); }
      String user = rest.size() > 0 ? rest.get(0) : System.getProperty("username");
      String pass = rest.size() > 1 ? rest.get(1) : System.getProperty("password");
      boolean encrypted = Boolean.getBoolean("encrypted");
      String knight = rest.size() > 2 ? rest.get(2) : System.getProperty("knight");
      String action = rest.size() > 3 ? rest.get(3) : System.getProperty("action");
      String arg = rest.size() > 4 ? rest.get(4) : System.getProperty("arg");
      String session = System.getProperty("sessionKey");
      Constructor<?> c = app.getConstructor(String.class, String.class, boolean.class, String.class, String.class, String.class, String.class, String.class);
      return c.newInstance(user, pass, encrypted, knight, action, arg, session, connect);
    } catch (Throwable t) {
      log("construct failed: " + t);
      return null;
    }
  }

  /** Swaps the scene director's repository for one that also captures each scene it handles. */
  static void wrapRepository(Object appInstance) throws Exception {
    Class<?> repo = null;
    for (String n : new String[] { REPOSITORY, REPOSITORY_OBF }) {
      try { repo = Class.forName(n); break; } catch (ClassNotFoundException e) { /* next */ }
    }
    if (repo == null) { log("scene repository interface not found"); return; }
    int swapped = 0;
    for (Object holder : fieldValues(appInstance)) {
      if (holder == null) continue;
      for (Class<?> k = holder.getClass(); k != null && k != Object.class; k = k.getSuperclass()) {
        for (Field f : k.getDeclaredFields()) {
          if (f.getType() != repo) continue;
          f.setAccessible(true);
          Object inner = f.get(holder);
          if (inner == null || Proxy.isProxyClass(inner.getClass())) continue;
          f.set(holder, Proxy.newProxyInstance(repo.getClassLoader(), new Class<?>[] { repo }, new Capturing(inner)));
          swapped++;
        }
      }
    }
    log(swapped > 0 ? "wrapped the scene repository" : "no scene repository field found; nothing will be captured");
  }

  static java.util.List<Object> fieldValues(Object o) throws IllegalAccessException {
    java.util.List<Object> out = new java.util.ArrayList<>();
    for (Class<?> k = o.getClass(); k != null && k != Object.class; k = k.getSuperclass())
      for (Field f : k.getDeclaredFields()) {
        if (f.getType().isPrimitive() || java.lang.reflect.Modifier.isStatic(f.getModifiers())) continue;
        try { f.setAccessible(true); out.add(f.get(o)); } catch (RuntimeException e) { /* inaccessible */ }
      }
    return out;
  }

  static final class Capturing implements InvocationHandler {
    final Object inner;
    Capturing(Object inner) { this.inner = inner; }
    public Object invoke(Object proxy, Method m, Object[] a) throws Throwable {
      Object r;
      try { r = m.invoke(inner, a); } catch (InvocationTargetException e) { throw e.getCause(); }
      // a scene model passed in (store) or returned (load)
      if (a != null) for (Object x : a) capture(x);
      capture(r);
      return r;
    }
  }

  static void capture(Object model) {
    if (model == null || !model.getClass().getName().endsWith("SceneModel")) return;
    try {
      int id = model.getClass().getField("sceneId").getInt(model);
      if (id <= INSTANCE_IDS) return; // fixed scenes: the client caches those itself
      int version = 0;
      try { version = model.getClass().getField("version").getInt(model); } catch (Exception e) { /* none */ }
      String key = id + "/" + version + "/" + System.identityHashCode(model);
      synchronized (written) { if (!written.add(key)) return; }
      String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss").format(new Date());
      File out = new File(dir, id + "_" + stamp);
      Class<?> ex = Class.forName("com.threerings.export.BinaryExporter");
      Object exporter = ex.getConstructor(OutputStream.class).newInstance(new FileOutputStream(out));
      try {
        writeObject(ex).invoke(exporter, model);
      } finally {
        ex.getMethod("close").invoke(exporter);
      }
      log("captured scene " + id + " -> " + out.getName());
    } catch (Throwable t) {
      log("capture failed: " + t);
    }
  }

  static Method writeObjectMethod;
  /** Exporter.writeObject(Object): the one public instance method taking a single Object. */
  static Method writeObject(Class<?> ex) throws NoSuchMethodException {
    if (writeObjectMethod != null) return writeObjectMethod;
    try { return writeObjectMethod = ex.getMethod("writeObject", Object.class); } catch (NoSuchMethodException e) { /* obfuscated */ }
    for (Method m : ex.getMethods())
      if (m.getParameterCount() == 1 && m.getParameterTypes()[0] == Object.class && m.getReturnType() == void.class
          && !java.lang.reflect.Modifier.isStatic(m.getModifiers()) && m.getDeclaringClass() != Object.class)
        return writeObjectMethod = m;
    throw new NoSuchMethodException("BinaryExporter.writeObject");
  }

  static void log(String s) { System.out.println("[scene-capture] " + s); }
}
