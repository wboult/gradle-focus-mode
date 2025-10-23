package com.example;

public class Project008 {
    public static void main(String[] args) {
        System.out.println("Hello from project-008");
        new Project005().doSomething();
        new Project004().doSomething();
    }

    public void doSomething() {
        System.out.println("project-008 doing something");
    }
}
