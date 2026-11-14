using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace HexglassDesktop;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Contains("--selftest")) return Lyrics.SelfTest();
        using var one = new Mutex(true, "HexglassDesktop", out bool first);
        if (!first) return 0;
        // No animation needs more than 60 fps, even on a faster screen.
        Timeline.DesiredFrameRateProperty.OverrideMetadata(typeof(Timeline), new FrameworkPropertyMetadata { DefaultValue = 60 });
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.Startup += (_, _) => new Desk().Start();
        return app.Run();
    }
}

record Line(double T, string Text);

sealed class Song
{
    public string Uri, Title, Artist;
    public BitmapSource Cover;
    public List<Line> Lines;
    public double Ms;
    public bool Playing;
    public DateTime At;
}

static class Lyrics
{
    // The line showing at song position ms: its index, -1 before the first.
    public static int LineAt(IReadOnlyList<Line> lines, double ms)
    {
        int i = -1;
        while (i + 1 < lines.Count && lines[i + 1].T <= ms) i++;
        return i;
    }

    // Exit code 0 when the timing logic holds: `HexglassDesktop.exe --selftest`.
    public static int SelfTest()
    {
        var l = new List<Line> { new(1000, "a"), new(4000, "b"), new(9000, "c") };
        bool ok = LineAt(l, 0) == -1 && LineAt(l, 1000) == 0 && LineAt(l, 8999) == 1 && LineAt(l, 60000) == 2 && LineAt(new List<Line>(), 5) == -1;
        return ok ? 0 : 1;
    }
}

static class Native
{
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);

    // Hidden by Windows without being minimized (suspended store apps, other virtual desktops).
    public static bool Cloaked(IntPtr h) => DwmGetWindowAttribute(h, 14, out int c, 4) == 0 && c != 0; // DWMWA_CLOAKED
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLong(IntPtr h, int index, IntPtr value);

    public static string ClassOf(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }

    // The layer between the wallpaper and the icons. Progman makes it on an undocumented message (what Lively and
    // Wallpaper Engine use). Before Windows 11 24H2 it is the top-level WorkerW after the one holding the icons;
    // since then it is a child of Progman.
    public static IntPtr DesktopLayer()
    {
        var progman = FindWindow("Progman", null);
        SendMessageTimeout(progman, 0x052C, (IntPtr)0xD, (IntPtr)1, 0, 1000, out _);
        IntPtr worker = IntPtr.Zero;
        EnumWindows((w, _) =>
        {
            if (FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) worker = FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
            return true;
        }, IntPtr.Zero);
        if (worker == IntPtr.Zero) worker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        return worker;
    }

    // Windows doesn't repaint the layer under a hidden or closed window: the last frame stays. Setting each screen's
    // own picture again repaints it. Picture wallpapers only, so a slideshow or solid colour is left alone.
    public static void RepaintWallpaper()
    {
        try
        {
            if (Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers", "BackgroundType", 0) is not (0 or null)) return;
            var w = (IDesktopWallpaper)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")));
            for (uint i = 0; i < w.GetMonitorDevicePathCount(); i++)
            {
                var id = w.GetMonitorDevicePathAt(i);
                var p = w.GetWallpaper(id);
                if (File.Exists(p)) w.SetWallpaper(id, p);
            }
        }
        catch (Exception) { }
    }
}

[ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDesktopWallpaper
{
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint monitorIndex);
    uint GetMonitorDevicePathCount();
}

// One screen's window behind the icons. Wide screens: cover left with title and artist under it, lyrics right,
// the group right of centre (desktop icons fill from the top left). Tall screens: stacked and centred. The lyric
// list is built once per song and only moved; nothing redraws between changes.
sealed class ScreenView
{
    sealed class Page
    {
        public Grid Root;
        public Image Bg;
        public Canvas Viewport;
        public StackPanel List;
        public TranslateTransform Scroll;
        public readonly List<TextBlock> Lines = new();
        public int[] Dist = Array.Empty<int>(); // each line's distance from the current one, as last styled
        public Song Song;
        public double Font;
        public bool Wide;
        public DropShadowEffect Glow;
    }

    static readonly double[] Dim = { 1, 0.45, 0.28, 0.16 }; // line opacity by distance from the current line
    static readonly FontFamily Font = new("Segoe UI Variable Display, Segoe UI");
    static readonly IEasingFunction Out = Frozen(new CubicEase { EasingMode = EasingMode.EaseOut });
    static readonly IEasingFunction InOut = Frozen(new CubicEase { EasingMode = EasingMode.EaseInOut });
    static readonly IEasingFunction Settle = Frozen(new BackEase { Amplitude = 0.12, EasingMode = EasingMode.EaseOut }); // a slight overshoot, like a spring
    static readonly IEasingFunction Gentle = Frozen(new QuinticEase { EasingMode = EasingMode.EaseOut });
    // In units, not relative: a relative mask stretches over the whole lyric list (far taller than the box), so the
    // fade landed off screen and the clip showed as a hard edge.
    static Brush EdgeFade(double height) => Frozen(new LinearGradientBrush(new GradientStopCollection
    {
        new(Color.FromArgb(0, 0, 0, 0), 0), new(Colors.Black, 0.14), new(Colors.Black, 0.84), new(Color.FromArgb(0, 0, 0, 0), 1),
    }, new Point(0, 0), new Point(0, height)) { MappingMode = BrushMappingMode.Absolute });

    static T Frozen<T>(T f) where T : Freezable { f.Freeze(); return f; }
    static bool Smooth => (RenderCapability.Tier >> 16) == 2; // drawn by the graphics card; in software, change instantly

    public readonly Forms.Screen Screen;
    public bool Covered; // a window fills this screen: change instantly, nobody sees an animation
    readonly Window win = new() { WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false, ShowActivated = false, Background = Brushes.Black };
    readonly Grid root = new();
    IntPtr hwnd;
    double w, h; // in WPF units
    Page page;

    public ScreenView(Forms.Screen s)
    {
        Screen = s;
        win.Content = root;
        TextOptions.SetTextRenderingMode(win, TextRenderingMode.Grayscale);
    }

    public void Attach(IntPtr layer)
    {
        hwnd = new WindowInteropHelper(win).EnsureHandle();
        // A tool window that never takes focus: kept out of Alt+Tab and the taskbar.
        const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000, WS_EX_NOACTIVATE = 0x8000000;
        long ex = Native.GetWindowLong(hwnd, GWL_EXSTYLE).ToInt64();
        Native.SetWindowLong(hwnd, GWL_EXSTYLE, new IntPtr((ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & ~WS_EX_APPWINDOW));
        Native.SetParent(hwnd, layer);
        win.Show();
        Native.GetWindowRect(layer, out var lr);
        var b = Screen.Bounds;
        Native.SetWindowPos(hwnd, IntPtr.Zero, b.Left - lr.Left, b.Top - lr.Top, b.Width, b.Height, 0x0004 | 0x0010); // NOZORDER | NOACTIVATE
        var dpi = VisualTreeHelper.GetDpi(win);
        w = b.Width / dpi.DpiScaleX;
        h = b.Height / dpi.DpiScaleY;
    }

    public void SetVisible(bool on) => Native.ShowWindow(hwnd, on ? 4 : 0); // SW_SHOWNOACTIVATE / SW_HIDE
    public void Close() => win.Close();

    // The new song fades in over the old one (never through black) while its background settles from a slight zoom.
    public void ShowSong(Song s, bool animate)
    {
        bool smooth = animate && Smooth;
        var old = page;
        page = BuildPage(s);
        root.Children.Add(page.Root);
        To(page.Root, UIElement.OpacityProperty, 1, smooth ? 900 : 0, InOut, () => { if (old != null) root.Children.Remove(old.Root); });
        if (page.Bg?.RenderTransform is ScaleTransform zoom)
        {
            To(zoom, ScaleTransform.ScaleXProperty, 1, smooth ? 1400 : 0, Gentle);
            To(zoom, ScaleTransform.ScaleYProperty, 1, smooth ? 1400 : 0, Gentle);
        }
    }

    public void SetLines(Song s) { if (page?.Song == s) Fill(page, s.Lines); }

    // Line i becomes current: the list glides so it sits a third of the way down, the lines just under it trail a
    // little (a ripple), and each line's brightness, size and glow follow its distance from it. -1 = before the first.
    public void ShowLine(int i, bool animate)
    {
        var p = page;
        if (p == null) return;
        bool smooth = animate && Smooth, any = p.Lines.Count > 0;
        To(p.Viewport, UIElement.OpacityProperty, any ? 1 : 0, smooth ? 400 : 0);
        if (!any) return;
        i = Math.Min(i, p.Lines.Count - 1);
        p.List.UpdateLayout();
        var cur = p.Lines[Math.Max(i, 0)]; // before the first line, the first one waits at the anchor, still dim
        double target = p.Viewport.Height * 0.35 - cur.TranslatePoint(new Point(0, 0), p.List).Y - cur.ActualHeight / 2;
        int ms = smooth ? 600 : 0;
        To(p.Scroll, TranslateTransform.YProperty, target, ms, Settle);
        for (int k = 0; k < p.Lines.Count; k++)
        {
            var parts = ((TransformGroup)p.Lines[k].RenderTransform).Children;
            if (smooth && k > i && k <= i + 3)
            {
                var lag = (TranslateTransform)parts[1];
                lag.BeginAnimation(TranslateTransform.YProperty, null);
                lag.Y = p.Font * 0.3 * (k - i);
                To(lag, TranslateTransform.YProperty, 0, ms + 80 * (k - i));
            }
            int dist = Math.Min(3, Math.Abs(k - i));
            if (p.Dist[k] == dist) continue;
            p.Dist[k] = dist;
            int fade = smooth && Math.Abs(k - i) <= 5 ? 380 : 0;
            To(p.Lines[k], UIElement.OpacityProperty, Dim[dist], fade);
            var size = (ScaleTransform)parts[0];
            To(size, ScaleTransform.ScaleXProperty, dist == 0 ? 1 : 0.96, fade);
            To(size, ScaleTransform.ScaleYProperty, dist == 0 ? 1 : 0.96, fade);
            p.Lines[k].Effect = dist == 0 ? p.Glow : null;
        }
    }

    Page BuildPage(Song s)
    {
        var p = new Page { Song = s, Wide = w > h, Root = new Grid { Opacity = 0, Background = new SolidColorBrush(Color.FromRgb(12, 12, 16)) } };
        if (s.Cover != null)
        {
            p.Bg = new Image { Source = Background(s.Cover, w, h), Stretch = Stretch.Fill, RenderTransformOrigin = new Point(0.5, 0.5), RenderTransform = new ScaleTransform(1.035, 1.035) };
            RenderOptions.SetBitmapScalingMode(p.Bg, BitmapScalingMode.HighQuality);
            p.Root.Children.Add(p.Bg);
        }
        var canvas = new Canvas();
        p.Root.Children.Add(canvas);

        const double taskbar = 48;
        double zc, coverX, coverY, textX, textW, vx, vy, vw, vh;
        TextAlignment align;
        if (p.Wide)
        {
            zc = Math.Round(Math.Min(w * 0.24, h * 0.46));
            double gap = w * 0.04, groupH = zc * 1.24;
            coverX = w * 0.27;
            coverY = Math.Max(24, (h - taskbar - groupH) / 2);
            textX = coverX; textW = zc; align = TextAlignment.Left;
            vx = coverX + zc + gap; vy = coverY; vw = w * 0.95 - vx; vh = groupH;
            p.Font = Math.Round(h * 0.04);
        }
        else
        {
            // A smaller cover so the lyrics get room (about 8 lines), with a clear gap under the artist.
            zc = Math.Round(w * 0.5);
            vh = h * 0.42;
            double groupH = zc * 1.38 + vh;
            coverX = (w - zc) / 2;
            coverY = Math.Max(24, (h - taskbar - groupH) / 2);
            textX = w * 0.07; textW = w * 0.86; align = TextAlignment.Center;
            vx = textX; vy = coverY + zc * 1.38; vw = textW;
            p.Font = Math.Round(w * 0.045);
        }

        var cover = new Border
        {
            Width = zc, Height = zc, CornerRadius = new CornerRadius(zc * 0.035),
            Background = s.Cover != null ? new ImageBrush(s.Cover) { Stretch = Stretch.UniformToFill } : Brushes.DimGray,
            Effect = new DropShadowEffect { BlurRadius = 40, ShadowDepth = 12, Direction = 270, Opacity = 0.45 },
            CacheMode = new BitmapCache(),
        };
        Place(canvas, cover, coverX, coverY);
        Place(canvas, Label(s.Title, zc * (p.Wide ? 0.075 : 0.09), FontWeights.Bold, 1, textW, align), textX, coverY + zc * 1.06);
        Place(canvas, Label(s.Artist, zc * (p.Wide ? 0.05 : 0.062), FontWeights.Medium, 0.65, textW, align), textX, coverY + zc * (p.Wide ? 1.16 : 1.19));

        p.Scroll = new TranslateTransform();
        p.List = new StackPanel { Width = vw, RenderTransform = p.Scroll };
        p.Viewport = new Canvas { Width = vw, Height = vh, ClipToBounds = true, Opacity = 0, OpacityMask = EdgeFade(vh) };
        p.Viewport.Children.Add(p.List);
        Place(canvas, p.Viewport, vx, vy);
        p.Glow = Frozen(new DropShadowEffect { Color = Colors.White, ShadowDepth = 0, BlurRadius = p.Font * 0.4, Opacity = 0.35 });
        Fill(p, s.Lines);
        return p;
    }

    static void Fill(Page p, List<Line> lines)
    {
        p.List.Children.Clear();
        p.Lines.Clear();
        foreach (var l in lines ?? new List<Line>())
        {
            var parts = new TransformGroup();
            parts.Children.Add(new ScaleTransform(0.96, 0.96));
            parts.Children.Add(new TranslateTransform());
            var tb = new TextBlock
            {
                Text = l.Text, TextWrapping = TextWrapping.Wrap, FontSize = p.Font, FontWeight = FontWeights.Bold, FontFamily = Font, Foreground = Brushes.White,
                TextAlignment = p.Wide ? TextAlignment.Left : TextAlignment.Center, Margin = new Thickness(0, 0, 0, p.Font * 0.5),
                Opacity = Dim[3], RenderTransform = parts, RenderTransformOrigin = p.Wide ? new Point(0, 0.5) : new Point(0.5, 0.5),
                CacheMode = new BitmapCache(), // its own fade, size and glow then move a cached picture, not re-drawn text
            };
            p.List.Children.Add(tb);
            p.Lines.Add(tb);
        }
        p.Dist = Enumerable.Repeat(3, p.Lines.Count).ToArray();
    }

    static TextBlock Label(string t, double size, FontWeight weight, double alpha, double width, TextAlignment align) => new()
    {
        Text = t ?? "", FontSize = Math.Max(1, size), FontWeight = weight, FontFamily = Font, Width = width, TextAlignment = align,
        Foreground = new SolidColorBrush(Color.FromArgb((byte)(alpha * 255), 255, 255, 255)), TextTrimming = TextTrimming.CharacterEllipsis,
    };

    static void Place(Canvas c, UIElement e, double x, double y) { Canvas.SetLeft(e, x); Canvas.SetTop(e, y); c.Children.Add(e); }

    // Made once per song: the cover filling the screen, drawn 400 px wide and lightly blurred (the look of the wash
    // inside Spotify), then darkened, made more colourful and vignetted pixel by pixel, and shown stretched.
    static BitmapSource Background(BitmapSource cover, double w, double h)
    {
        int bw = 400, bh = Math.Max(1, (int)Math.Round(400 * h / w));
        double s = Math.Max(bw, bh) * 1.06; // a little past the edges so the blur leaves no dark rim
        var img = new Image { Source = cover, Width = s, Height = s, Stretch = Stretch.Fill, Effect = new BlurEffect { Radius = 4 } };
        var host = new Canvas { Width = bw, Height = bh, ClipToBounds = true };
        Canvas.SetLeft(img, (bw - s) / 2);
        Canvas.SetTop(img, (bh - s) / 2);
        host.Children.Add(img);
        host.Measure(new Size(bw, bh));
        host.Arrange(new Rect(0, 0, bw, bh));
        var rtb = new RenderTargetBitmap(bw, bh, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(host);
        int stride = bw * 4;
        var px = new byte[stride * bh];
        rtb.CopyPixels(px, stride, 0);
        for (int y = 0; y < bh; y++)
            for (int x = 0; x < bw; x++)
            {
                int o = y * stride + x * 4;
                double dx = (x + 0.5) / bw - 0.5, dy = (y + 0.5) / bh - 0.5;
                double light = 0.66 * (1 - 0.4 * Math.Min(1, (dx * dx + dy * dy) * 2)); // 66% in the middle, 40% in the corners
                double b = px[o], g = px[o + 1], r = px[o + 2], grey = 0.299 * r + 0.587 * g + 0.114 * b;
                px[o] = Byte((grey + (b - grey) * 1.4) * light);
                px[o + 1] = Byte((grey + (g - grey) * 1.4) * light);
                px[o + 2] = Byte((grey + (r - grey) * 1.4) * light);
                px[o + 3] = 255;
            }
        var result = BitmapSource.Create(bw, bh, 96, 96, PixelFormats.Pbgra32, null, px, stride);
        result.Freeze();
        return result;
    }

    static byte Byte(double v) => (byte)Math.Clamp(Math.Round(v), 0, 255);

    // Animates p on t to `to` from wherever it is now (so interrupted animations hand over smoothly); 0 ms sets it.
    static void To(IAnimatable t, DependencyProperty p, double to, int ms, IEasingFunction ease = null, Action done = null)
    {
        if (ms <= 0) { t.BeginAnimation(p, null); ((DependencyObject)t).SetValue(p, to); done?.Invoke(); return; }
        var a = new DoubleAnimation(to, TimeSpan.FromMilliseconds(ms)) { EasingFunction = ease ?? Out };
        if (done != null) a.Completed += (_, _) => done();
        t.BeginAnimation(p, a);
    }
}

// Listens to the helper, keeps the song's clock, and decides what shows. Lyrics always follow the song (a line change
// costs almost nothing); a screen a window fills just changes without animating, since nobody sees it.
sealed class Desk
{
    const string Url = "http://127.0.0.1:47999/desktop/events";
    const double LeadMs = 150; // start moving to a line this early, so it has settled when the line is sung
    readonly List<ScreenView> views = new();
    readonly DispatcherTimer lineTimer = new(), poll = new() { Interval = TimeSpan.FromMilliseconds(500) };
    Song song;
    int shown = -2;
    IntPtr layer;
    Forms.NotifyIcon tray;

    public void Start()
    {
        Place();
        lineTimer.Tick += (_, _) => { lineTimer.Stop(); Schedule(); };
        poll.Tick += (_, _) => Poll();
        poll.Start();
        tray = new Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Text = "Hexglass Desktop", Visible = true, ContextMenuStrip = new Forms.ContextMenuStrip() };
        tray.ContextMenuStrip.Items.Add("Quit", null, (_, _) => { tray.Visible = false; Application.Current.Shutdown(); });
        _ = Listen();
    }

    // One window per screen in the layer behind the icons; again whenever Explorer restarts and takes the layer.
    void Place()
    {
        foreach (var v in views) v.Close();
        views.Clear();
        layer = Native.DesktopLayer();
        foreach (var s in Forms.Screen.AllScreens) { var v = new ScreenView(s); v.Attach(layer); views.Add(v); }
        foreach (var v in views) { v.SetVisible(song != null); if (song != null) v.ShowSong(song, false); }
        shown = -2;
        Schedule();
    }

    double Pos() => song == null ? 0 : song.Playing ? song.Ms + (DateTime.Now - song.At).TotalMilliseconds : song.Ms;

    // Which screens a visible window fills (maximized or full screen), whichever window has focus.
    void Poll()
    {
        if (!Native.IsWindow(layer)) { Place(); return; }
        foreach (var v in views) v.Covered = false;
        Native.EnumWindows((hw, _) =>
        {
            if (!Native.IsWindowVisible(hw) || Native.IsIconic(hw) || Native.Cloaked(hw) || Native.ClassOf(hw) is "Progman" or "WorkerW") return true;
            Native.GetWindowRect(hw, out var r);
            foreach (var v in views)
            {
                var a = v.Screen.WorkingArea; // a maximized window fills the area above the taskbar
                if (r.Left <= a.Left && r.Top <= a.Top && r.Right >= a.Right && r.Bottom >= a.Bottom) v.Covered = true;
            }
            return true;
        }, IntPtr.Zero);
    }

    void Schedule()
    {
        lineTimer.Stop();
        if (song == null) return;
        double p = Pos() + LeadMs;
        int i = song.Lines != null ? Lyrics.LineAt(song.Lines, p) : -1;
        if (i != shown) { shown = i; foreach (var v in views) v.ShowLine(i, !v.Covered); }
        if (song.Playing && song.Lines != null && i + 1 < song.Lines.Count)
        {
            lineTimer.Interval = TimeSpan.FromMilliseconds(Math.Max(20, song.Lines[i + 1].T - p));
            lineTimer.Start();
        }
    }

    async Task Listen()
    {
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        while (true)
        {
            try
            {
                using var res = await http.GetAsync(Url, HttpCompletionOption.ResponseHeadersRead);
                using var reader = new StreamReader(await res.Content.ReadAsStreamAsync());
                string ev = null;
                var data = new StringBuilder();
                for (string line; (line = await reader.ReadLineAsync()) != null;)
                {
                    if (line.StartsWith("event: ")) ev = line[7..];
                    else if (line.StartsWith("data: ")) data.Append(line[6..]);
                    else if (line.Length == 0 && ev != null) { Handle(ev, data.ToString()); ev = null; data.Clear(); }
                }
            }
            catch (Exception) { } // helper not running yet, or restarting
            Handle("clear", "{}");
            await Task.Delay(5000);
        }
    }

    void Handle(string ev, string json)
    {
        JsonElement d;
        try { d = JsonDocument.Parse(json).RootElement; } catch (JsonException) { return; }
        if (ev == "clear")
        {
            bool showing = song != null;
            song = null;
            shown = -2;
            lineTimer.Stop();
            foreach (var v in views) v.SetVisible(false); // Spotify closed: your own wallpaper shows
            if (showing) Native.RepaintWallpaper();
        }
        else if (ev == "quit")
        {
            Handle("clear", "{}");
            tray.Visible = false;
            Application.Current.Shutdown();
        }
        else if (ev == "song")
        {
            song = new Song { Uri = Str(d, "uri"), Title = Str(d, "title"), Artist = Str(d, "artist"), Cover = Picture(Str(d, "cover")), Lines = Lines(d), Ms = Num(d, "ms"), Playing = Flag(d, "playing"), At = DateTime.Now };
            shown = -2;
            foreach (var v in views) { v.SetVisible(true); v.ShowSong(song, !v.Covered); }
            Schedule();
        }
        else if (ev == "state" && song != null && Str(d, "uri") == song.Uri)
        {
            song.Ms = Num(d, "ms");
            song.Playing = Flag(d, "playing");
            song.At = DateTime.Now;
            var lines = Lines(d);
            if (lines != null)
            {
                song.Lines = lines;
                shown = -2;
                foreach (var v in views) v.SetLines(song);
            }
            Schedule();
        }
    }

    static string Str(JsonElement d, string k) => d.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : "";
    static double Num(JsonElement d, string k) => d.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
    static bool Flag(JsonElement d, string k) => d.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;

    static List<Line> Lines(JsonElement d)
    {
        if (!d.TryGetProperty("lines", out var a) || a.ValueKind != JsonValueKind.Array) return null;
        var list = a.EnumerateArray().Select(x => new Line(Num(x, "t"), Str(x, "text"))).Where(l => l.Text.Length > 0).OrderBy(l => l.T).ToList();
        return list.Count > 0 ? list : null;
    }

    static BitmapSource Picture(string base64)
    {
        if (string.IsNullOrEmpty(base64)) return null;
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.StreamSource = new MemoryStream(Convert.FromBase64String(base64));
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch (Exception) { return null; }
    }
}
