using System;
using System.Collections.Generic;

namespace Demo
{
    public class Thing
    {
        public void Go()
        {
            string s = "hello";
            var x = s.NoSuchMember();
            Widget w = new Widget();
            var q = System.Nonexistent.Whatever();
        }
    }
}
