// Real editable GTK window for the continuous demonstration; no mocked extension UI.
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
const [output] = ARGV;
const app = new Gtk.Application({application_id:'org.palette.DemoEditor'});
app.connect('activate',()=>{
    const view = new Gtk.TextView({wrap_mode:Gtk.WrapMode.WORD_CHAR,
        top_margin:24,left_margin:28,right_margin:28,bottom_margin:24,vexpand:true});
    view.buffer.text='Hey team,\n\n';
    view.buffer.place_cursor(view.buffer.get_end_iter());
    view.buffer.connect('changed',()=>GLib.file_set_contents(output,view.buffer.text));
    const css=new Gtk.CssProvider();
    css.load_from_data('textview {font-size: 19px;} textview text {background-color: #242428; color: #eeeeec;}', -1);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),css,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    const box = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL});
    const header=new Gtk.HeaderBar();
    header.title_widget=new Gtk.Label({label:'Launch notes',css_classes:['title']});
    box.append(view);
    const win=new Gtk.ApplicationWindow({application:app,title:'Launch notes',
        default_width:640,default_height:420,child:box});
    win.set_titlebar(header);
    win.present();view.grab_focus();
});
app.run([]);
